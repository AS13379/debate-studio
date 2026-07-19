import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

export interface LanNetworkAddress {
  address: string
  family: 'IPv4' | 'IPv6'
  interfaceName: string
}

const VIRTUAL_INTERFACE = /^(lo|docker|veth|br-|bridge|vmnet|vbox|utun|awdl|llw|gif|stf|tailscale|wg)/i

export class NetworkAddressService {
  constructor(private readonly readInterfaces: typeof networkInterfaces = networkInterfaces) {}

  listAdvertisableAddresses(includeIpv6 = false): LanNetworkAddress[] {
    const results: LanNetworkAddress[] = []
    const interfaces = this.readInterfaces()
    for (const [interfaceName, records] of Object.entries(interfaces)) {
      if (!records || VIRTUAL_INTERFACE.test(interfaceName)) continue
      for (const record of records) {
        if (record.internal) continue
        if (record.family === 'IPv4' && isPrivateIpv4(record.address)) {
          results.push({ address: record.address, family: 'IPv4', interfaceName })
        } else if (includeIpv6 && record.family === 'IPv6' && isUniqueLocalIpv6(record.address)) {
          results.push({ address: stripIpv6Zone(record.address), family: 'IPv6', interfaceName })
        }
      }
    }
    return deduplicate(results).sort((left, right) => left.address.localeCompare(right.address))
  }

  listAccessUrls(port: number, includeIpv6 = false): string[] {
    return this.listAdvertisableAddresses(includeIpv6).map((entry) => entry.family === 'IPv6'
      ? `http://[${entry.address}]:${port}`
      : `http://${entry.address}:${port}`)
  }
}

export function isAllowedLanAddress(value: string | undefined): boolean {
  if (!value) return false
  const address = normalizeRemoteAddress(value)
  return address === '127.0.0.1' || address === '::1' || isPrivateIpv4(address) ||
    isUniqueLocalIpv6(address) || isLinkLocalIpv6(address)
}

export function isAllowedBindHost(value: string): boolean {
  return value === '0.0.0.0' || value === '::' || isAllowedLanAddress(value)
}

export function normalizeRemoteAddress(value: string): string {
  const withoutZone = stripIpv6Zone(value.trim().toLowerCase())
  return withoutZone.startsWith('::ffff:') ? withoutZone.slice(7) : withoutZone
}

export function isPrivateIpv4(value: string): boolean {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
}

export function isUniqueLocalIpv6(value: string): boolean {
  const normalized = stripIpv6Zone(value).toLowerCase()
  return normalized.startsWith('fc') || normalized.startsWith('fd')
}

export function isLinkLocalIpv6(value: string): boolean {
  return stripIpv6Zone(value).toLowerCase().startsWith('fe8') ||
    stripIpv6Zone(value).toLowerCase().startsWith('fe9') ||
    stripIpv6Zone(value).toLowerCase().startsWith('fea') ||
    stripIpv6Zone(value).toLowerCase().startsWith('feb')
}

function stripIpv6Zone(value: string): string {
  return value.split('%')[0]
}

function deduplicate(values: LanNetworkAddress[]): LanNetworkAddress[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (seen.has(value.address)) return false
    seen.add(value.address)
    return true
  })
}
