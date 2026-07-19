import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { LoggerLike } from '../observability'
import type { LanConnectedDeviceDto } from '../shared/lan-dtos'

export interface LanAuthenticatedSession extends LanConnectedDeviceDto {
  csrfToken: string
  tokenHash: string
}

export interface LanSessionCreation {
  token: string
  session: LanAuthenticatedSession
}

export class LanAuthService {
  private readonly sessions = new Map<string, LanAuthenticatedSession>()

  constructor(
    private readonly getSessionTimeoutMinutes: () => number,
    private readonly logger?: LoggerLike,
    private readonly now: () => Date = () => new Date()
  ) {}

  createSession(label: string, address: string): LanSessionCreation {
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
    this.logger?.info('局域网设备已建立会话', {
      source: 'lan-auth', metadata: { deviceId: session.id, address: maskAddress(address) }
    })
    return { token, session: { ...session } }
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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sanitizeDeviceLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || '局域网浏览器'
}

function maskAddress(value: string): string {
  const parts = value.split('.')
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : value.slice(0, 8)
}
