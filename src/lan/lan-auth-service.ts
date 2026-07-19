import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import type { LoggerLike } from '../observability'
import type { CredentialStore } from '../security'
import type { LanConnectedDeviceDto, LanResultDto } from '../shared/lan-dtos'

export const LAN_PASSWORD_CREDENTIAL_REFERENCE = 'debate-studio:lan-access-password'

export interface LanAuthenticatedSession extends LanConnectedDeviceDto {
  csrfToken: string
  tokenHash: string
}

export interface LanLoginSuccess {
  token: string
  session: LanAuthenticatedSession
}

export class LanAuthService {
  private readonly sessions = new Map<string, LanAuthenticatedSession>()

  constructor(
    private readonly credentialStore: CredentialStore,
    private readonly getSessionTimeoutMinutes: () => number,
    private readonly logger?: LoggerLike,
    private readonly now: () => Date = () => new Date()
  ) {}

  async ensurePassword(): Promise<LanResultDto<{ created: boolean; password?: string }>> {
    const current = await this.credentialStore.hasCredential(LAN_PASSWORD_CREDENTIAL_REFERENCE)
    if (!current.ok) return authFailure('LAN_CREDENTIAL_UNAVAILABLE', '无法使用系统加密存储', '系统加密存储当前不可用，局域网服务未启动。', true)
    if (current.value) return { ok: true, value: { created: false } }
    const password = generateAccessPassword()
    const saved = await this.credentialStore.setCredential(LAN_PASSWORD_CREDENTIAL_REFERENCE, password)
    if (!saved.ok) return authFailure('LAN_PASSWORD_SAVE_FAILED', '访问密码保存失败', '无法将局域网访问密码写入系统加密存储。', true)
    return { ok: true, value: { created: true, password } }
  }

  async hasPassword(): Promise<boolean> {
    const result = await this.credentialStore.hasCredential(LAN_PASSWORD_CREDENTIAL_REFERENCE)
    return result.ok && result.value
  }

  async revealPassword(): Promise<LanResultDto<string>> {
    const result = await this.credentialStore.getCredential(LAN_PASSWORD_CREDENTIAL_REFERENCE)
    if (!result.ok || !result.value) return authFailure('LAN_PASSWORD_NOT_CONFIGURED', '尚未配置访问密码', '请先开启局域网访问或重新生成密码。', false)
    return { ok: true, value: result.value }
  }

  async setPassword(password: string): Promise<LanResultDto<void>> {
    if (password.length < 10 || password.length > 256) {
      return authFailure('LAN_PASSWORD_INVALID', '访问密码不符合要求', '访问密码长度必须在 10 到 256 个字符之间。', false)
    }
    const result = await this.credentialStore.setCredential(LAN_PASSWORD_CREDENTIAL_REFERENCE, password)
    if (!result.ok) return authFailure('LAN_PASSWORD_SAVE_FAILED', '访问密码保存失败', '系统加密存储未能保存新的访问密码。', true)
    this.logoutAll()
    this.logger?.info('局域网访问密码已更新', { source: 'lan-auth' })
    return { ok: true, value: undefined }
  }

  async regeneratePassword(): Promise<LanResultDto<string>> {
    const password = generateAccessPassword()
    const result = await this.setPassword(password)
    return result.ok ? { ok: true, value: password } : result
  }

  async login(password: string, label: string, address: string): Promise<LanResultDto<LanLoginSuccess>> {
    const stored = await this.credentialStore.getCredential(LAN_PASSWORD_CREDENTIAL_REFERENCE)
    if (!stored.ok || !stored.value) return authFailure('LAN_PASSWORD_NOT_CONFIGURED', '局域网访问尚未准备好', '请在桌面客户端重新生成访问密码。', false)
    if (!safeEquals(password, stored.value)) {
      this.logger?.warn('局域网登录失败', { source: 'lan-auth', metadata: { address: maskAddress(address) } })
      return authFailure('LAN_LOGIN_FAILED', '访问密码错误', '请检查桌面客户端中显示的局域网访问密码。', true)
    }
    this.cleanupExpired()
    const token = randomBytes(32).toString('base64url')
    const tokenHash = hashToken(token)
    const createdAt = this.now().toISOString()
    const expiresAt = new Date(this.now().getTime() + this.getSessionTimeoutMinutes() * 60_000).toISOString()
    const session: LanAuthenticatedSession = {
      id: randomUUID(),
      label: sanitizeDeviceLabel(label),
      address,
      createdAt,
      lastAccessAt: createdAt,
      expiresAt,
      csrfToken: randomBytes(24).toString('base64url'),
      tokenHash
    }
    this.sessions.set(tokenHash, session)
    this.logger?.info('局域网设备登录成功', { source: 'lan-auth', metadata: { deviceId: session.id, address: maskAddress(address) } })
    return { ok: true, value: { token, session: { ...session } } }
  }

  authenticate(
    token: string | undefined,
    binding?: { address: string; label: string },
    touch = true
  ): LanAuthenticatedSession | undefined {
    if (!token) return undefined
    this.cleanupExpired()
    const session = this.sessions.get(hashToken(token))
    if (!session) return undefined
    if (binding && (session.address !== binding.address || session.label !== sanitizeDeviceLabel(binding.label))) return undefined
    if (touch) session.lastAccessAt = this.now().toISOString()
    return { ...session }
  }

  logout(token: string | undefined): boolean {
    return token ? this.sessions.delete(hashToken(token)) : false
  }

  logoutAll(): void {
    this.sessions.clear()
  }

  kickDevice(deviceId: string): boolean {
    for (const [tokenHash, session] of this.sessions) {
      if (session.id === deviceId) return this.sessions.delete(tokenHash)
    }
    return false
  }

  listDevices(): LanConnectedDeviceDto[] {
    this.cleanupExpired()
    return [...this.sessions.values()].map(({ csrfToken: _csrf, tokenHash: _tokenHash, ...device }) => ({ ...device }))
  }

  private cleanupExpired(): void {
    const now = this.now().getTime()
    for (const [key, session] of this.sessions) {
      if (new Date(session.expiresAt).getTime() <= now) this.sessions.delete(key)
    }
  }
}

function generateAccessPassword(): string {
  const raw = randomBytes(12).toString('base64url').toUpperCase()
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeEquals(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

function sanitizeDeviceLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || '局域网浏览器'
}

function maskAddress(value: string): string {
  const parts = value.split('.')
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : value.slice(0, 8)
}

function authFailure<T>(code: string, titleZh: string, descriptionZh: string, retryable: boolean): LanResultDto<T> {
  return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
}
