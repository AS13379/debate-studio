import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'

import type { LoggerLike } from '../observability'
import {
  lanCommandSchema,
  lanDebateListQuerySchema,
  lanSessionParamsSchema,
  lanSnapshotQuerySchema
} from '../shared/lan-schemas'
import type {
  LanAuthSessionDto,
  LanResultDto,
  LanServerConfigDto,
  LanServerStatusDto
} from '../shared/lan-dtos'
import { isAllowedBindHost, isAllowedLanAddress, isLoopbackAddress, NetworkAddressService, normalizeRemoteAddress } from './network-address-service'
import { LanWebApplication } from './lan-web-application'

const SESSION_COOKIE = 'debate_studio_lan_session'

export interface LanServerManagerOptions {
  application: LanWebApplication
  webRoot: string
  appVersion: string
  networkAddresses?: NetworkAddressService
  logger?: LoggerLike
  now?: () => Date
  addressPollMs?: number
  createServer?: typeof createLanHttpServer
}

type StatusListener = (status: LanServerStatusDto) => void

export class LanServerManager {
  private readonly networkAddresses: NetworkAddressService
  private readonly now: () => Date
  private readonly listeners = new Set<StatusListener>()
  private server?: FastifyInstance
  private lifecycle: LanServerStatusDto['lifecycle'] = 'stopped'
  private startedAt?: string
  private lastAccessAt?: string
  private error?: LanServerStatusDto['error']
  private addressPoll?: ReturnType<typeof setInterval>
  private accessUrls: string[] = []

  constructor(private readonly options: LanServerManagerOptions) {
    this.networkAddresses = options.networkAddresses ?? new NetworkAddressService()
    this.now = options.now ?? (() => new Date())
  }

  async initialize(): Promise<LanResultDto<LanServerStatusDto>> {
    return this.options.application.getConfig().enabled ? this.start(false) : this.statusResult()
  }

  async start(persistEnabled = true): Promise<LanResultDto<LanServerStatusDto>> {
    if (this.lifecycle === 'running') return this.statusResult()
    if (this.lifecycle === 'starting' || this.lifecycle === 'stopping') {
      return failure('LAN_SERVER_BUSY', '局域网服务正在切换状态', '请稍候再试。', true)
    }
    const config = this.options.application.getConfig()
    if (!isAllowedBindHost(config.host)) return failure('LAN_HOST_NOT_ALLOWED', '监听地址不安全', '只能监听本机、私有局域网或通配本地地址。', false)
    this.lifecycle = 'starting'
    this.error = undefined
    this.emitStatus()
    const attempt = await this.listenWithPolicy(config)
    if (!attempt.ok) {
      this.lifecycle = 'error'
      this.error = attempt.error
      this.emitStatus()
      return attempt
    }
    this.server = attempt.value.server
    this.lifecycle = 'running'
    this.startedAt = this.now().toISOString()
    const actualConfig = { ...config, port: attempt.value.port, enabled: persistEnabled ? true : config.enabled }
    this.options.application.saveConfig(actualConfig)
    this.refreshAccessUrls(actualConfig)
    this.beginAddressPolling()
    this.options.logger?.info('局域网服务已启动', { source: 'lan-server', metadata: { port: actualConfig.port } })
    this.emitStatus()
    return this.statusResult()
  }

  async stop(persistEnabled = true): Promise<LanResultDto<LanServerStatusDto>> {
    if (this.lifecycle === 'stopped') {
      if (persistEnabled) this.persistEnabled(false)
      this.options.application.auth.logoutAll()
      return this.statusResult()
    }
    this.lifecycle = 'stopping'
    this.emitStatus()
    this.endAddressPolling()
    await this.closeServer()
    this.options.application.auth.logoutAll()
    if (persistEnabled) this.persistEnabled(false)
    this.lifecycle = 'stopped'
    this.startedAt = undefined
    this.accessUrls = []
    this.error = undefined
    this.options.logger?.info('局域网服务已停止', { source: 'lan-server' })
    this.emitStatus()
    return this.statusResult()
  }

  async restart(): Promise<LanResultDto<LanServerStatusDto>> {
    const config = this.options.application.getConfig()
    await this.stop(false)
    this.options.application.saveConfig({ ...config, enabled: true })
    return this.start(false)
  }

  async updateConfig(update: Partial<Pick<LanServerConfigDto, 'accessMode' | 'port' | 'sessionTimeoutMinutes' | 'autoPort'>>): Promise<LanResultDto<LanServerStatusDto>> {
    const previous = this.options.application.getConfig()
    const candidate = {
      ...previous,
      ...update,
      host: (update.accessMode ?? previous.accessMode) === 'lan' ? '0.0.0.0' : '127.0.0.1',
      authenticationMode: 'none' as const
    }
    if (!Number.isInteger(candidate.port) || candidate.port < 1024 || candidate.port > 65535) {
      return failure('LAN_PORT_INVALID', '端口无效', '端口必须是 1024 到 65535 之间的整数。', false)
    }
    if (!Number.isInteger(candidate.sessionTimeoutMinutes) || candidate.sessionTimeoutMinutes < 15 || candidate.sessionTimeoutMinutes > 10_080) {
      return failure('LAN_SESSION_TIMEOUT_INVALID', '会话有效期无效', '会话有效期必须在 15 分钟到 7 天之间。', false)
    }
    const listenerUnchanged = candidate.port === previous.port && candidate.host === previous.host
    if (this.lifecycle !== 'running' || listenerUnchanged) {
      const saved = this.options.application.saveConfig(candidate)
      if (!saved.ok) return saved
      this.emitStatus()
      return this.statusResult()
    }

    await this.stop(false)
    this.options.application.saveConfig({ ...candidate, enabled: true })
    const started = await this.start(false)
    if (started.ok) return started
    this.options.application.saveConfig(previous)
    await this.start(false)
    return started
  }

  getStatus(): LanResultDto<LanServerStatusDto> {
    return this.statusResult()
  }

  listAccessUrls(): string[] {
    return [...this.accessUrls]
  }

  logoutAllDevices(): LanResultDto<boolean> {
    this.options.application.auth.logoutAll()
    this.emitStatus()
    return { ok: true, value: true }
  }

  kickDevice(deviceId: string): LanResultDto<boolean> {
    const kicked = this.options.application.auth.kickDevice(deviceId)
    this.emitStatus()
    return kicked ? { ok: true, value: true } : failure('LAN_DEVICE_NOT_FOUND', '设备会话不存在', '该设备可能已经退出或会话已经过期。', false)
  }

  getPreviewUrl(): LanResultDto<string> {
    if (this.lifecycle !== 'running') return failure('LAN_SERVER_NOT_RUNNING', '局域网服务未运行', '请先开启局域网访问。', false)
    const config = this.options.application.getConfig()
    return { ok: true, value: `http://127.0.0.1:${config.port}` }
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async suspend(): Promise<void> {
    if (this.lifecycle !== 'running') return
    this.endAddressPolling()
    await this.closeServer()
    this.options.application.auth.logoutAll()
    this.lifecycle = 'suspended'
    this.accessUrls = []
    this.emitStatus()
  }

  async resume(): Promise<void> {
    if (this.lifecycle !== 'suspended' || !this.options.application.getConfig().enabled) return
    this.lifecycle = 'stopped'
    await this.start(false)
  }

  async close(): Promise<void> {
    this.endAddressPolling()
    await this.stop(false)
    this.listeners.clear()
  }

  private async listenWithPolicy(config: LanServerConfigDto): Promise<LanResultDto<{ server: FastifyInstance; port: number }>> {
    const maximumAttempts = config.autoPort ? 21 : 1
    for (let offset = 0; offset < maximumAttempts; offset += 1) {
      const port = config.port + offset
      if (port > 65535) break
      const server = (this.options.createServer ?? createLanHttpServer)({
        application: this.options.application,
        webRoot: this.options.webRoot,
        appVersion: this.options.appVersion,
        networkAddresses: this.networkAddresses,
        logger: this.options.logger,
        onAccess: () => this.recordAccess()
      })
      try {
        await server.listen({ host: config.host, port })
        const address = server.server.address() as AddressInfo | null
        return { ok: true, value: { server, port: address?.port ?? port } }
      } catch (cause) {
        await server.close().catch(() => undefined)
        this.options.logger?.error('局域网服务监听失败', {
          source: 'lan-server',
          metadata: {
            port,
            code: errorCode(cause),
            message: cause instanceof Error ? cause.message : 'unknown'
          }
        })
        if (!isAddressInUse(cause) || !config.autoPort) {
          return failure(
            isAddressInUse(cause) ? 'LAN_PORT_IN_USE' : 'LAN_SERVER_START_FAILED',
            isAddressInUse(cause) ? '局域网端口已被占用' : '局域网服务启动失败',
            isAddressInUse(cause) ? `端口 ${port} 已被其他程序使用，请更换端口。` : '无法启动本地 HTTP 服务，请查看诊断日志。',
            true
          )
        }
      }
    }
    return failure('LAN_AUTO_PORT_EXHAUSTED', '没有可用端口', '自动端口范围内没有找到可用端口，请手动指定。', true)
  }

  private async closeServer(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server) await server.close().catch(() => undefined)
  }

  private statusResult(): LanResultDto<LanServerStatusDto> {
    const config = this.options.application.getConfig()
    return {
      ok: true,
      value: {
        lifecycle: this.lifecycle,
        config,
        accessUrls: [...this.accessUrls],
        startedAt: this.startedAt,
        lastAccessAt: this.lastAccessAt,
        devices: this.options.application.auth.listDevices(),
        error: this.error ? { ...this.error } : undefined
      }
    }
  }

  async statusWithCredentialState(): Promise<LanResultDto<LanServerStatusDto>> {
    return this.statusResult()
  }

  private persistEnabled(enabled: boolean): void {
    const current = this.options.application.getConfig()
    this.options.application.saveConfig({ ...current, enabled })
  }

  private refreshAccessUrls(config = this.options.application.getConfig()): void {
    this.accessUrls = config.accessMode === 'localhost'
      ? [`http://localhost:${config.port}`]
      : this.networkAddresses.listAccessUrls(config.port, config.host === '::')
  }

  private beginAddressPolling(): void {
    this.endAddressPolling()
    this.addressPoll = setInterval(() => {
      const before = this.accessUrls.join('|')
      this.refreshAccessUrls()
      if (before !== this.accessUrls.join('|')) this.emitStatus()
    }, this.options.addressPollMs ?? 5_000)
    this.addressPoll.unref?.()
  }

  private endAddressPolling(): void {
    if (this.addressPoll) clearInterval(this.addressPoll)
    this.addressPoll = undefined
  }

  private recordAccess(): void {
    const now = this.now().toISOString()
    if (!this.lastAccessAt || this.now().getTime() - new Date(this.lastAccessAt).getTime() >= 5_000) {
      this.lastAccessAt = now
      this.emitStatus()
    }
  }

  private emitStatus(): void {
    const result = this.statusResult()
    if (!result.ok) return
    for (const listener of this.listeners) listener(result.value)
  }
}

interface CreateLanHttpServerOptions {
  application: LanWebApplication
  webRoot: string
  appVersion: string
  networkAddresses: NetworkAddressService
  logger?: LoggerLike
  onAccess?(): void
}

export function createLanHttpServer(options: CreateLanHttpServerOptions): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 64 * 1024, requestIdHeader: false, genReqId: () => randomUUID() })
  const hasWebUi = existsSync(join(options.webRoot, 'index.html'))
  void server.register(cookie)
  void server.register(helmet, {
    strictTransportSecurity: false,
    frameguard: { action: 'deny' },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'ws:'],
        'font-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"]
      }
    },
    referrerPolicy: { policy: 'no-referrer' }
  })
  void server.register(rateLimit, { max: 120, timeWindow: '1 minute' })
  void server.register(websocket, { options: { maxPayload: 16 * 1024, perMessageDeflate: false } })
  if (hasWebUi) void server.register(fastifyStatic, { root: options.webRoot, wildcard: false })

  server.addHook('onRequest', async (request, reply) => {
    const config = options.application.getConfig()
    const sourceAllowed = config.accessMode === 'localhost'
      ? isLoopbackAddress(request.socket.remoteAddress)
      : isAllowedLanAddress(request.socket.remoteAddress)
    if (!sourceAllowed) {
      options.logger?.warn('拒绝非局域网来源请求', { source: 'lan-server' })
      return reply.code(403).send(apiFailure('LAN_SOURCE_REJECTED', '访问来源未获允许', config.accessMode === 'localhost' ? '当前仅允许这台 Mac 本机访问。' : '此功能只允许本机和私有局域网设备访问。', false))
    }
    if (!isAllowedHost(request.headers.host, options.application.getConfig(), options.networkAddresses)) {
      return reply.code(403).send(apiFailure('LAN_HOST_REJECTED', '访问地址未获允许', '请求使用了无效的 Host。', false))
    }
    const origin = request.headers.origin
    if (origin && !allowedOrigins(options.application.getConfig(), options.networkAddresses).has(origin)) {
      return reply.code(403).send(apiFailure('LAN_ORIGIN_REJECTED', '网页来源未获允许', '请求来源不属于当前 Debate Studio 局域网地址。', false))
    }
    if (origin) reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    options.onAccess?.()
  })

  server.get('/api/v1/public/status', async () => ({
    ok: true,
    value: { appName: 'Debate Studio', version: options.appVersion, authenticationRequired: false }
  }))

  server.get('/api/v1/auth/session', async (request, reply) => {
    const current = authenticateRequest(request, options)
    if (current) return { ok: true, value: authSessionDto(current) }
    const result = options.application.auth.createSession(
      coarseDeviceLabel(request.headers['user-agent']),
      normalizeRemoteAddress(request.socket.remoteAddress ?? '')
    )
    const maxAge = options.application.getConfig().sessionTimeoutMinutes * 60
    reply.setCookie(SESSION_COOKIE, result.token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge })
    return { ok: true, value: authSessionDto(result.session) }
  })

  server.post('/api/v1/auth/logout', async (request, reply) => {
    const session = authenticateRequest(request, options)
    if (!session) return reply.code(401).send(unauthorized())
    if (!validCsrf(request, session.csrfToken)) return reply.code(403).send(csrfFailure())
    options.application.auth.logout(request.cookies[SESSION_COOKIE])
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true, value: true }
  })

  server.get('/api/v1/debates', async (request, reply) => {
    if (!authenticateRequest(request, options)) return reply.code(401).send(unauthorized())
    const parsed = lanDebateListQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send(inputFailure())
    return options.application.listDebates(parsed.data)
  })

  server.get('/api/v1/debates/:id', async (request, reply) => {
    if (!authenticateRequest(request, options)) return reply.code(401).send(unauthorized())
    const id = typeof (request.params as { id?: unknown }).id === 'string' ? (request.params as { id: string }).id : ''
    if (!id || id.length > 200) return reply.code(400).send(inputFailure())
    const result = options.application.getDebate(id)
    return result.ok ? result : reply.code(result.error.code.includes('NOT_FOUND') ? 404 : 400).send(result)
  })

  server.get('/api/v1/sessions/:sessionId/snapshot', async (request, reply) => {
    if (!authenticateRequest(request, options)) return reply.code(401).send(unauthorized())
    const params = lanSessionParamsSchema.safeParse(request.params)
    const query = lanSnapshotQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) return reply.code(400).send(inputFailure())
    const result = options.application.getSnapshot(params.data.sessionId, {
      limit: query.data.limit,
      before: query.data.beforeCreatedAt && query.data.beforeId
        ? { createdAt: query.data.beforeCreatedAt, id: query.data.beforeId }
        : undefined
    })
    return result.ok ? result : reply.code(404).send(result)
  })

  server.post('/api/v1/sessions/:sessionId/commands', async (request, reply) => {
    const session = authenticateRequest(request, options)
    if (!session) return reply.code(401).send(unauthorized())
    if (!validCsrf(request, session.csrfToken)) return reply.code(403).send(csrfFailure())
    const params = lanSessionParamsSchema.safeParse(request.params)
    const body = lanCommandSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send(inputFailure())
    const result = await options.application.executeCommand(params.data.sessionId, body.data.command)
    return result.ok ? result : reply.code(result.error.code.includes('INVALID') || result.error.code.includes('ACTIVE') ? 409 : 400).send(result)
  })

  server.get('/api/v1/sessions/:sessionId/events', {
    websocket: true,
    preValidation: async (request, reply) => {
      if (!hasRequiredOrigin(request, options)) return reply.code(403).send()
      if (!authenticateRequest(request, options)) return reply.code(401).send()
      const params = lanSessionParamsSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send()
    }
  }, (socket: WebSocket, request) => {
    const params = lanSessionParamsSchema.parse(request.params)
    const unsubscribe = options.application.subscribe(params.sessionId, (event) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(event))
    })
    socket.send(JSON.stringify({
      protocolVersion: 1,
      type: 'ready',
      streamEpoch: options.application.streamEpoch,
      sessionId: params.sessionId,
      latestSequence: options.application.getLatestSequence(params.sessionId)
    }))
    socket.once('close', unsubscribe)
    socket.once('error', unsubscribe)
  })

  if (!hasWebUi) server.get('/', async (_request, reply) =>
    reply.code(503).type('text/plain; charset=utf-8').send('LAN Web UI 尚未构建。'))
  server.get('/favicon.ico', async (_request, reply) => reply.code(204).send())
  server.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send(apiFailure('LAN_API_NOT_FOUND', '接口不存在', '请求的局域网接口不存在。', false))
    return reply.code(404).type('text/plain; charset=utf-8').send('Not Found')
  })

  return server
}

function authenticateRequest(request: FastifyRequest, options: CreateLanHttpServerOptions) {
  return options.application.auth.authenticate(request.cookies[SESSION_COOKIE], {
    address: normalizeRemoteAddress(request.socket.remoteAddress ?? ''),
    label: coarseDeviceLabel(request.headers['user-agent'])
  })
}

function authSessionDto(session: { id: string; expiresAt: string; csrfToken: string }): LanAuthSessionDto {
  return { deviceId: session.id, expiresAt: session.expiresAt, csrfToken: session.csrfToken }
}

function hasRequiredOrigin(request: FastifyRequest, options: CreateLanHttpServerOptions): boolean {
  const origin = request.headers.origin
  return typeof origin === 'string' && allowedOrigins(options.application.getConfig(), options.networkAddresses).has(origin)
}

function validCsrf(request: FastifyRequest, expected: string): boolean {
  return typeof request.headers['x-csrf-token'] === 'string' && request.headers['x-csrf-token'] === expected
}

function allowedOrigins(config: LanServerConfigDto, addresses: NetworkAddressService): Set<string> {
  const loopback = [
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
    `http://[::1]:${config.port}`
  ]
  return new Set(config.accessMode === 'localhost'
    ? loopback
    : [...loopback, ...addresses.listAccessUrls(config.port, config.host === '::')])
}

function isAllowedHost(host: string | undefined, config: LanServerConfigDto, addresses: NetworkAddressService): boolean {
  if (!host) return false
  try {
    return allowedOrigins(config, addresses).has(new URL(`http://${host}`).origin)
  } catch {
    return false
  }
}

function coarseDeviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return '局域网浏览器'
  if (/iphone|ipad/i.test(userAgent)) return 'iPhone / iPad Safari'
  if (/android/i.test(userAgent)) return 'Android 浏览器'
  if (/macintosh/i.test(userAgent)) return 'Mac 浏览器'
  if (/windows/i.test(userAgent)) return 'Windows 浏览器'
  return '局域网浏览器'
}

function unauthorized() {
  return apiFailure('LAN_SESSION_REQUIRED', '访问会话已失效', '请刷新页面重新建立本地会话。', true)
}

function csrfFailure() {
  return apiFailure('LAN_CSRF_REJECTED', '操作验证已失效', '请刷新页面重新建立安全会话。', true)
}

function inputFailure() {
  return apiFailure('LAN_INPUT_INVALID', '请求参数无效', '请刷新页面后重试。', false)
}

function apiFailure(code: string, titleZh: string, descriptionZh: string, retryable: boolean) {
  return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
}

function failure<T>(code: string, titleZh: string, descriptionZh: string, retryable: boolean): LanResultDto<T> {
  return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
}

function isAddressInUse(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EADDRINUSE'
}

function errorCode(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : 'UNKNOWN'
}
