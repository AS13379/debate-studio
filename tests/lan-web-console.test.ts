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

  it('creates passwordless sessions bound to the client address and browser class, expires them, and revokes them', () => {
    let current = new Date('2026-07-19T00:00:00.000Z')
    const auth = new LanAuthService(() => 15, undefined, () => current)
    const login = auth.createSession('Mac 浏览器', '192.168.1.20')

    expect(auth.authenticate(login.token, { address: '192.168.1.20', label: 'Mac 浏览器' })).toBeDefined()
    expect(auth.authenticate(login.token, { address: '192.168.1.21', label: 'Mac 浏览器' })).toBeUndefined()
    expect(auth.authenticate(login.token, { address: '192.168.1.20', label: 'Android 浏览器' })).toBeUndefined()
    current = new Date('2026-07-19T00:16:00.000Z')
    expect(auth.authenticate(login.token, { address: '192.168.1.20', label: 'Mac 浏览器' })).toBeUndefined()

    current = new Date('2026-07-19T00:17:00.000Z')
    const second = auth.createSession('Mac 浏览器', '192.168.1.20')
    auth.logoutAll()
    expect(auth.authenticate(second.token, { address: '192.168.1.20', label: 'Mac 浏览器' })).toBeUndefined()
  })

  it('establishes a passwordless strict session while retaining Origin, CSRF and Host protection', async () => {
    const app = createApplication(temporaryDirectory(), new MemoryCredentialStore())
    app.configuration.createMockDemoDebate()
    const network = new NetworkAddressService(() => ({ en0: [record('192.168.1.8', 'IPv4')] }) as never)
    const server = createLanHttpServer({ application: app.lanWeb, webRoot: temporaryDirectory(), appVersion: '0.4.0', networkAddresses: network })
    await server.ready()

    const common = { host: '127.0.0.1:27180', origin: 'http://127.0.0.1:27180' }
    const publicStatus = await server.inject({ method: 'GET', url: '/api/v1/public/status', headers: { host: common.host } })
    expect(publicStatus.statusCode).toBe(200)
    expect(publicStatus.json()).toMatchObject({ ok: true, value: { version: '0.4.0', authenticationRequired: false } })
    expect(publicStatus.headers['strict-transport-security']).toBeUndefined()
    expect(publicStatus.headers['x-frame-options']).toBe('DENY')

    expect((await server.inject({ method: 'GET', url: '/api/v1/debates', headers: { host: common.host } })).statusCode).toBe(401)

    const login = await server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: common })
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
    for (const forbidden of ['apikey', 'credentialref', 'authorization', 'password', '/users/']) expect(serialized).not.toContain(forbidden)

    const noCsrf = await server.inject({ method: 'POST', url: '/api/v1/sessions/mock-demo-session/commands', headers: { ...common, cookie: cookieValue }, payload: { command: 'start' } })
    expect(noCsrf.statusCode).toBe(403)
    const withCsrf = await server.inject({ method: 'POST', url: '/api/v1/sessions/mock-demo-session/commands', headers: { ...common, cookie: cookieValue, 'x-csrf-token': csrfToken }, payload: { command: 'start' } })
    expect(withCsrf.statusCode).toBe(200)

    expect((await server.inject({ method: 'GET', url: '/api/v1/debates', headers: { host: 'evil.example:27180' } })).statusCode).toBe(403)
    expect((await server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: common, remoteAddress: '192.168.1.20' })).statusCode).toBe(403)
    expect((await server.inject({ method: 'GET', url: '/api/v1/debates', headers: { host: common.host }, remoteAddress: '8.8.8.8' })).statusCode).toBe(403)
    await server.close()
  })

  it('allows private clients only after explicitly switching to passwordless LAN mode', async () => {
    const app = createApplication(temporaryDirectory(), new MemoryCredentialStore())
    app.lanWeb.saveConfig({ ...app.lanWeb.getConfig(), accessMode: 'lan', host: '0.0.0.0' })
    const network = new NetworkAddressService(() => ({ en0: [record('192.168.1.8', 'IPv4')] }) as never)
    const server = createLanHttpServer({ application: app.lanWeb, webRoot: temporaryDirectory(), appVersion: 'test', networkAddresses: network })
    await server.ready()
    const response = await server.inject({
      method: 'GET', url: '/api/v1/auth/session', remoteAddress: '192.168.1.20',
      headers: { host: '192.168.1.8:27180', origin: 'http://192.168.1.8:27180' }
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['set-cookie']).toContain('HttpOnly')
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

  it('authenticates a real WebSocket handshake and delivers the shared run stream', async () => {
    const app = createApplication(temporaryDirectory(), new MemoryCredentialStore())
    const demo = app.configuration.createMockDemoDebate()
    if (!demo.ok) throw demo.error
    const serverErrors: unknown[] = []
    const server = createLanHttpServer({
      application: app.lanWeb, webRoot: temporaryDirectory(), appVersion: 'test', networkAddresses: new NetworkAddressService(() => ({})),
      logger: {
        debug: () => undefined, info: () => undefined, warn: () => undefined,
        error: (_message, context) => serverErrors.push(context.metadata)
      }
    })
    await server.ready()
    const session = await openBrowserSession(server)

    const messages: Array<{ type?: string; event?: { type: string } }> = []
    const socket = await server.injectWS(`/api/v1/sessions/${demo.value.sessionId}/events`, {
      headers: { ...session.readHeaders, 'user-agent': 'LAN WebSocket Test' },
      socket: { remoteAddress: '127.0.0.1' } as never
    }, {
      onInit: (webSocket) => webSocket.on('message', (data) => messages.push(JSON.parse(String(data))))
    }).catch((error) => { throw new Error(`${error instanceof Error ? error.message : String(error)} ${JSON.stringify(serverErrors)}`) })
    await waitFor(() => messages.some((message) => message.type === 'ready'))
    await app.run.start(demo.value.sessionId)
    await waitFor(() => messages.some((message) => message.event?.type === 'sessionCompleted'))
    socket.close()
    await server.close()
  })

  it('supports the Phase B history, research, safe upload, export and download flow without exposing local paths', async () => {
    const app = createApplication(temporaryDirectory(), new MemoryCredentialStore())
    const network = new NetworkAddressService(() => ({ en0: [record('192.168.1.8', 'IPv4')] }) as never)
    const server = createLanHttpServer({ application: app.lanWeb, webRoot: temporaryDirectory(), appVersion: 'test', networkAddresses: network })
    await server.ready()
    const session = await openBrowserSession(server)

    const created = await server.inject({ method: 'POST', url: '/api/v1/debates/mock', headers: session.writeHeaders, payload: {} })
    expect(created.statusCode).toBe(201)
    const debate = created.json().value as { id: string; sessionId: string; displayTitle: string; participants: Array<{ id: string; role: string }> }
    expect(debate.displayTitle).toBeTruthy()

    const listed = await server.inject({ method: 'GET', url: '/api/v1/debates?limit=20', headers: session.readHeaders })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().value.debates).toHaveLength(1)

    const research = await server.inject({ method: 'GET', url: `/api/v1/sessions/${debate.sessionId}/research`, headers: session.readHeaders })
    expect(research.statusCode).toBe(200)
    expect(research.body.toLowerCase()).not.toContain('localpath')

    const affirmative = debate.participants.find((participant) => participant.role === 'affirmative')!
    const png = Buffer.alloc(24)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
    png.writeUInt32BE(1, 16)
    png.writeUInt32BE(1, 20)
    const uploadQuery = new URLSearchParams({
      sessionId: debate.sessionId,
      ownerParticipantId: affirmative.id,
      visibility: 'affirmative-private',
      title: '手机上传图片',
      fileName: '../../private.png'
    })
    const uploaded = await server.inject({
      method: 'POST', url: `/api/v1/assets?${uploadQuery}`, headers: { ...session.writeHeaders, 'content-type': 'image/png' }, payload: png
    })
    expect(uploaded.statusCode).toBe(201)
    expect(uploaded.json()).toMatchObject({ ok: true, value: { kind: 'image', title: '手机上传图片', hasLocalFile: true } })
    expect(uploaded.body.toLowerCase()).not.toContain('localpath')
    expect(uploaded.body).not.toContain('/Users/')

    const pdfQuery = new URLSearchParams({
      sessionId: debate.sessionId,
      ownerParticipantId: affirmative.id,
      visibility: 'affirmative-private',
      title: '手机上传 PDF',
      fileName: 'evidence.pdf'
    })
    const uploadedPdf = await server.inject({
      method: 'POST', url: `/api/v1/assets?${pdfQuery}`, headers: { ...session.writeHeaders, 'content-type': 'application/pdf' },
      payload: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF')
    })
    expect(uploadedPdf.statusCode).toBe(201)
    expect(uploadedPdf.json()).toMatchObject({ ok: true, value: { kind: 'pdf', title: '手机上传 PDF', hasLocalFile: true } })
    expect(uploadedPdf.body.toLowerCase()).not.toContain('localpath')

    const invalidUpload = await server.inject({
      method: 'POST', url: `/api/v1/assets?${uploadQuery}`, headers: { ...session.writeHeaders, 'content-type': 'image/png' }, payload: Buffer.from('not-an-image')
    })
    expect(invalidUpload).toMatchObject({ statusCode: 400 })
    expect(invalidUpload.json()).toMatchObject({ ok: false, error: { code: 'LAN_UPLOAD_INVALID' } })

    const started = await server.inject({
      method: 'POST', url: `/api/v1/sessions/${debate.sessionId}/commands`, headers: session.writeHeaders, payload: { command: 'start' }
    })
    expect(started.statusCode).toBe(200)
    await waitFor(() => runStatus(app, debate.sessionId) === 'completed')

    const exporting = await server.inject({
      method: 'POST', url: `/api/v1/debates/${debate.id}/exports`, headers: session.writeHeaders,
      payload: { type: 'markdown', includePrivateResearch: false }
    })
    expect(exporting.statusCode).toBe(202)
    const exportId = exporting.json().value.exportId as string
    expect(exporting.body.toLowerCase()).not.toContain('filepath')
    await waitFor(() => isExportComplete(app, exportId))

    const exports = await server.inject({ method: 'GET', url: `/api/v1/exports?debateId=${debate.id}`, headers: session.readHeaders })
    expect(exports.statusCode).toBe(200)
    expect(exports.body.toLowerCase()).not.toContain('filepath')
    const downloaded = await server.inject({ method: 'GET', url: `/api/v1/exports/${exportId}/download`, headers: session.readHeaders })
    expect(downloaded.statusCode).toBe(200)
    expect(downloaded.headers['content-disposition']).toContain('attachment')
    expect(downloaded.body).toContain('#')
    await server.close()
  })

  it('passes start, pause, resume and stop through the Web command boundary', async () => {
    const directory = temporaryDirectory()
    const initialized = initializeDebateDesktopApplication({
      appDataDirectory: directory,
      credentialStore: new MemoryCredentialStore(),
      streamWriteThrottleMs: 0,
      mockAdapter: new MockAdapter({ chunks: Array.from({ length: 30 }, () => '慢速输出'), delayMs: 8 })
    })
    if (!initialized.ok) throw initialized.error
    const app = initialized.value
    applications.push(app)
    const created = app.configuration.createMockDemoDebate()
    if (!created.ok) throw created.error
    const server = createLanHttpServer({ application: app.lanWeb, webRoot: temporaryDirectory(), appVersion: 'test', networkAddresses: new NetworkAddressService(() => ({})) })
    await server.ready()
    const session = await openBrowserSession(server)
    const command = (value: 'start' | 'pause' | 'resume' | 'stop') => server.inject({
      method: 'POST', url: `/api/v1/sessions/${created.value.sessionId}/commands`, headers: session.writeHeaders, payload: { command: value }
    })

    expect((await command('start')).statusCode).toBe(200)
    await waitFor(() => isRunActive(app, created.value.sessionId))
    expect((await command('pause')).statusCode).toBe(200)
    await waitFor(() => runStatus(app, created.value.sessionId) === 'paused')
    expect((await command('resume')).statusCode).toBe(200)
    await waitFor(() => isRunActive(app, created.value.sessionId))
    expect((await command('stop')).statusCode).toBe(200)
    await waitFor(() => runStatus(app, created.value.sessionId) === 'stopped')
    await server.close()
  })

  it('plans and creates an editable debate through the passwordless Web boundary', async () => {
    const directory = temporaryDirectory()
    const planJson = JSON.stringify({
      background: '围绕学习节奏与教学质量展开。',
      affirmativePosition: '正方主张设立无课自主学习日。',
      negativePosition: '反方主张维持现有课程安排。',
      keyQuestions: ['自主学习是否提升学习质量？'],
      researchDirections: ['比较不同课程制度'],
      evidenceSuggestions: ['学校公开统计']
    })
    const initialized = initializeDebateDesktopApplication({
      appDataDirectory: directory,
      credentialStore: new MemoryCredentialStore(),
      streamWriteThrottleMs: 0,
      mockAdapter: new MockAdapter({ chunks: [planJson], delayMs: 0 })
    })
    if (!initialized.ok) throw initialized.error
    const app = initialized.value
    applications.push(app)
    const seeded = app.configuration.createMockDemoDebate()
    if (!seeded.ok) throw seeded.error
    const server = createLanHttpServer({ application: app.lanWeb, webRoot: temporaryDirectory(), appVersion: 'test', networkAddresses: new NetworkAddressService(() => ({})) })
    await server.ready()
    const session = await openBrowserSession(server)

    const profiles = await server.inject({ method: 'GET', url: '/api/v1/model-profiles', headers: session.readHeaders })
    expect(profiles.statusCode).toBe(200)
    const profileId = profiles.json().value[0].id as string
    expect(profiles.body.toLowerCase()).not.toContain('credentialref')

    const planned = await server.inject({
      method: 'POST', url: '/api/v1/planner', headers: session.writeHeaders,
      payload: { operationId: 'lan-plan-test', mode: 'auto', topic: '大学是否应设置无课自主学习日？', depth: 'standard' }
    })
    expect(planned.statusCode).toBe(200)
    expect(planned.json()).toMatchObject({ ok: true, value: { plan: { topic: '大学是否应设置无课自主学习日？' } } })
    expect(planned.json().value.plan.affirmativePosition).toBeTruthy()

    const planning = planned.json().value
    const created = await server.inject({
      method: 'POST', url: '/api/v1/debates', headers: session.writeHeaders,
      payload: {
        debate: {
          topic: planning.plan.topic,
          background: planning.plan.background,
          affirmativePosition: planning.plan.affirmativePosition,
          negativePosition: planning.plan.negativePosition,
          freeDebateRounds: 1,
          planning
        },
        bindings: {
          affirmativeModelProfileId: profileId,
          negativeModelProfileId: profileId,
          moderatorModelProfileId: profileId
        }
      }
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ ok: true, value: { topic: '大学是否应设置无课自主学习日？', displayTitle: '大学是否应设置无课自主学习日？' } })
    await server.close()
  })
})

async function openBrowserSession(server: FastifyInstance) {
  const base = { host: '127.0.0.1:27180', origin: 'http://127.0.0.1:27180' }
  const response = await server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: base })
  const cookie = String(response.headers['set-cookie']).split(';')[0]
  const csrf = response.json().value.csrfToken as string
  return {
    readHeaders: { ...base, cookie },
    writeHeaders: { ...base, cookie, 'x-csrf-token': csrf }
  }
}

async function waitFor(check: () => boolean, timeoutMs = 4_000) {
  const startedAt = Date.now()
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for LAN Web state.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function runStatus(app: DebateDesktopApplication, sessionId: string) {
  const result = app.run.getRunState(sessionId)
  return result.ok ? result.state.status : undefined
}

function isRunActive(app: DebateDesktopApplication, sessionId: string) {
  const status = runStatus(app, sessionId)
  return status === 'running' || status === 'streaming'
}

function isExportComplete(app: DebateDesktopApplication, exportId: string) {
  const result = app.exports.getExportHistory()
  return result.ok && result.value.some((record) => record.exportId === exportId && record.status === 'completed')
}

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
