import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { initializeDebateDesktopApplication, type DebateDesktopApplication } from '../src/application'
import { createLanHttpServer, LanAuthService, LanServerManager, NetworkAddressService } from '../src/lan'
import { MockAdapter } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const directories: string[] = []
const applications: DebateDesktopApplication[] = []

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('LAN Web Console security and lifecycle', () => {
  it('keeps the service disabled by default, persists manual activation, and auto-starts on reopen', async () => {
    const directory = temporaryDirectory()
    const credentialStore = new MemoryCredentialStore()
    const app = createApplication(directory, credentialStore)
    const port = 27180
    app.lanWeb.saveConfig({ ...app.lanWeb.getConfig(), host: '127.0.0.1', port })
    const manager = new LanServerManager({ application: app.lanWeb, webRoot: directory, appVersion: 'test', createServer: fakeServerFactory() })

    expect(await manager.initialize()).toMatchObject({ ok: true, value: { lifecycle: 'stopped', config: { enabled: false } } })
    expect(await manager.start()).toMatchObject({ ok: true, value: { lifecycle: 'running', config: { enabled: true, port } } })
    await manager.close()
    await app.close()
    applications.splice(applications.indexOf(app), 1)

    const reopened = createApplication(directory, credentialStore)
    const reopenedManager = new LanServerManager({ application: reopened.lanWeb, webRoot: directory, appVersion: 'test', createServer: fakeServerFactory() })
    expect(await reopenedManager.initialize()).toMatchObject({ ok: true, value: { lifecycle: 'running', config: { enabled: true, port } } })
    await reopenedManager.close()
  })

  it('filters advertised addresses and accepts only private or loopback clients', () => {
    const network = new NetworkAddressService(() => ({
      en0: [record('192.168.1.8', 'IPv4')],
      en1: [record('8.8.8.8', 'IPv4')],
      utun4: [record('10.8.0.2', 'IPv4')],
      lo0: [record('127.0.0.1', 'IPv4', true)],
      en2: [record('fd00::10', 'IPv6')]
    }) as never)

    expect(network.listAdvertisableAddresses()).toEqual([{ address: '192.168.1.8', family: 'IPv4', interfaceName: 'en0' }])
    expect(network.listAdvertisableAddresses(true)).toEqual([
      { address: '192.168.1.8', family: 'IPv4', interfaceName: 'en0' },
      { address: 'fd00::10', family: 'IPv6', interfaceName: 'en2' }
    ])
  })

  it('binds sessions to the client address and browser class, expires them, and revokes all on password change', async () => {
    const store = new MemoryCredentialStore()
    let current = new Date('2026-07-19T00:00:00.000Z')
    const auth = new LanAuthService(store, () => 15, undefined, () => current)
    await auth.setPassword('safe-lan-password-123')
    const login = await auth.login('safe-lan-password-123', 'Mac 浏览器', '192.168.1.20')
    if (!login.ok) throw login.error

    expect(auth.authenticate(login.value.token, { address: '192.168.1.20', label: 'Mac 浏览器' })).toBeDefined()
    expect(auth.authenticate(login.value.token, { address: '192.168.1.21', label: 'Mac 浏览器' })).toBeUndefined()
    expect(auth.authenticate(login.value.token, { address: '192.168.1.20', label: 'Android 浏览器' })).toBeUndefined()
    current = new Date('2026-07-19T00:16:00.000Z')
    expect(auth.authenticate(login.value.token, { address: '192.168.1.20', label: 'Mac 浏览器' })).toBeUndefined()

    const second = await auth.login('safe-lan-password-123', 'Mac 浏览器', '192.168.1.20')
    if (!second.ok) throw second.error
    await auth.setPassword('another-safe-password-456')
    expect(auth.authenticate(second.value.token, { address: '192.168.1.20', label: 'Mac 浏览器' })).toBeUndefined()
  })

  it('requires password, strict session cookie, Origin, CSRF and safe Host without leaking credentials', async () => {
    const app = createApplication(temporaryDirectory(), new MemoryCredentialStore())
    app.configuration.createMockDemoDebate()
    await app.lanWeb.auth.setPassword('safe-lan-password-123')
    const network = new NetworkAddressService(() => ({ en0: [record('192.168.1.8', 'IPv4')] }) as never)
    const server = createLanHttpServer({ application: app.lanWeb, webRoot: temporaryDirectory(), appVersion: '0.4.0', networkAddresses: network })
    await server.ready()

    const common = { host: '127.0.0.1:27180', origin: 'http://127.0.0.1:27180' }
    const publicStatus = await server.inject({ method: 'GET', url: '/api/v1/public/status', headers: { host: common.host } })
    expect(publicStatus.statusCode).toBe(200)
    expect(publicStatus.json()).toMatchObject({ ok: true, value: { version: '0.4.0', authenticationRequired: true } })
    expect(publicStatus.headers['strict-transport-security']).toBeUndefined()
    expect(publicStatus.headers['x-frame-options']).toBe('DENY')

    expect((await server.inject({ method: 'GET', url: '/api/v1/debates', headers: { host: common.host } })).statusCode).toBe(401)
    expect((await server.inject({ method: 'POST', url: '/api/v1/auth/login', headers: common, payload: { password: 'wrong-password' } })).statusCode).toBe(401)

    const login = await server.inject({ method: 'POST', url: '/api/v1/auth/login', headers: common, payload: { password: 'safe-lan-password-123' } })
    expect(login.statusCode).toBe(200)
    const cookie = login.headers['set-cookie'] as string
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toContain('Secure')
    const cookieValue = cookie.split(';')[0]
    const csrfToken = login.json().value.csrfToken as string

    const debates = await server.inject({ method: 'GET', url: '/api/v1/debates?limit=20', headers: { ...common, cookie: cookieValue } })
    expect(debates.statusCode).toBe(200)
    const serialized = debates.body.toLowerCase()
    for (const forbidden of ['apikey', 'credentialref', 'authorization', 'safe-lan-password-123', '/users/']) expect(serialized).not.toContain(forbidden)

    const noCsrf = await server.inject({ method: 'POST', url: '/api/v1/sessions/mock-demo-session/commands', headers: { ...common, cookie: cookieValue }, payload: { command: 'start' } })
    expect(noCsrf.statusCode).toBe(403)
    const withCsrf = await server.inject({ method: 'POST', url: '/api/v1/sessions/mock-demo-session/commands', headers: { ...common, cookie: cookieValue, 'x-csrf-token': csrfToken }, payload: { command: 'start' } })
    expect(withCsrf.statusCode).toBe(200)

    expect((await server.inject({ method: 'GET', url: '/api/v1/debates', headers: { host: 'evil.example:27180' } })).statusCode).toBe(403)
    expect((await server.inject({ method: 'GET', url: '/api/v1/debates', headers: { host: common.host }, remoteAddress: '8.8.8.8' })).statusCode).toBe(403)
    await server.close()
  })

  it('serves the built Web entry without registering a duplicate root route', async () => {
    const app = createApplication(temporaryDirectory(), new MemoryCredentialStore())
    const webRoot = temporaryDirectory()
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>LAN</title>')
    const server = createLanHttpServer({ application: app.lanWeb, webRoot, appVersion: 'test', networkAddresses: new NetworkAddressService(() => ({})) })
    await server.ready()
    const response = await server.inject({ method: 'GET', url: '/', headers: { host: '127.0.0.1:27180' } })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<title>LAN</title>')
    await server.close()
  })

  it('rolls back a conflicting port and keeps the old listener available', async () => {
    const app = createApplication(temporaryDirectory(), new MemoryCredentialStore())
    const oldPort = 27180
    app.lanWeb.saveConfig({ ...app.lanWeb.getConfig(), host: '127.0.0.1', port: oldPort })
    const occupiedPort = 28180
    const manager = new LanServerManager({
      application: app.lanWeb,
      webRoot: temporaryDirectory(),
      appVersion: 'test',
      createServer: fakeServerFactory(new Set([occupiedPort]))
    })
    expect((await manager.start()).ok).toBe(true)
    const changed = await manager.updateConfig({ port: occupiedPort, autoPort: false })
    expect(changed).toMatchObject({ ok: false, error: { code: 'LAN_PORT_IN_USE' } })
    expect(manager.getStatus()).toMatchObject({ ok: true, value: { lifecycle: 'running', config: { port: oldPort } } })
    await manager.close()
  })

  it('shares one ordered event stream across clients and exposes a resynchronization snapshot', async () => {
    const app = createApplication(temporaryDirectory(), new MemoryCredentialStore())
    app.configuration.createMockDemoDebate()
    const first: number[] = []
    const second: number[] = []
    const offFirst = app.lanWeb.subscribe('mock-demo-session', (event) => first.push(event.sequence))
    const offSecond = app.lanWeb.subscribe('mock-demo-session', (event) => second.push(event.sequence))

    const result = await app.run.start('mock-demo-session')
    await new Promise((resolve) => setTimeout(resolve, 130))
    const snapshot = app.lanWeb.getSnapshot('mock-demo-session')

    expect(result.ok).toBe(true)
    expect(first.length).toBeGreaterThan(5)
    expect(second).toEqual(first)
    expect(first).toEqual([...first].sort((left, right) => left - right))
    expect(new Set(first).size).toBe(first.length)
    expect(snapshot).toMatchObject({ ok: true, value: { streamEpoch: app.lanWeb.streamEpoch, latestSequence: first.at(-1) } })
    offFirst(); offSecond()
  })
})

function createApplication(directory: string, credentialStore: MemoryCredentialStore): DebateDesktopApplication {
  const result = initializeDebateDesktopApplication({
    appDataDirectory: directory,
    credentialStore,
    streamWriteThrottleMs: 0,
    mockAdapter: new MockAdapter({ chunks: ['Mock'], delayMs: 0 })
  })
  if (!result.ok) throw result.error
  applications.push(result.value)
  return result.value
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'debate-lan-'))
  directories.push(directory)
  return directory
}

function record(address: string, family: 'IPv4' | 'IPv6', internal = false) {
  return family === 'IPv4'
    ? { address, family, internal, netmask: '255.255.255.0', cidr: null, mac: '00:00:00:00:00:00' }
    : { address, family, internal, netmask: 'ffff:ffff::', cidr: null, mac: '00:00:00:00:00:00', scopeid: 0 }
}

function fakeServerFactory(occupiedPorts = new Set<number>()) {
  return () => {
    let port = 0
    return {
      server: { address: () => ({ address: '127.0.0.1', family: 'IPv4', port }) },
      listen: async (options: { port: number }) => {
        if (occupiedPorts.has(options.port)) throw Object.assign(new Error('address in use'), { code: 'EADDRINUSE' })
        port = options.port
        return `http://127.0.0.1:${port}`
      },
      close: async () => undefined
    } as unknown as FastifyInstance
  }
}
