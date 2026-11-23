import { getHostname } from 'tldts'

// Match @better-auth/sso's DNS verification parser, including URL-shaped entries.
export function normalizeSsoDomains(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const domains = new Set<string>()
  for (const entry of value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const hostname = getHostname(entry)
    if (!hostname) return null
    domains.add(hostname.toLowerCase())
  }
  return domains.size ? [...domains].join(',') : null
}
