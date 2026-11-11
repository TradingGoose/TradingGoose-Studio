/**
 * Extract storage key from a file path
 * Handles various path formats: /api/files/serve/xyz, /api/files/serve/s3/xyz, etc.
 * Strips query parameters from the path before extracting the key.
 */
export function extractStorageKey(filePath: string): string {
  const pathWithoutQuery = filePath.split('?')[0]

  if (pathWithoutQuery.includes('/api/files/serve/s3/')) {
    return decodeURIComponent(pathWithoutQuery.split('/api/files/serve/s3/')[1])
  }
  if (pathWithoutQuery.includes('/api/files/serve/azure/')) {
    return decodeURIComponent(pathWithoutQuery.split('/api/files/serve/azure/')[1])
  }
  if (pathWithoutQuery.includes('/api/files/serve/vercel/')) {
    return decodeURIComponent(pathWithoutQuery.split('/api/files/serve/vercel/')[1])
  }
  if (pathWithoutQuery.includes('/api/files/serve/')) {
    return decodeURIComponent(pathWithoutQuery.split('/api/files/serve/')[1])
  }
  return pathWithoutQuery
}

export function sanitizeFileKey(key: string): string {
  if (!key.includes('/')) {
    throw new Error('File key must include a path prefix')
  }
  if (key.split('/').some((segment) => segment.length === 0)) {
    throw new Error('File key contains an empty path segment')
  }

  return key
    .split('/')
    .map((segment, index, segments) => {
      if (segment === '.' || segment === '..') {
        throw new Error('Path traversal detected in file key')
      }
      const pattern = index === segments.length - 1 ? /[^a-zA-Z0-9.-]/g : /[^a-zA-Z0-9-]/g
      return segment.replace(pattern, '_')
    })
    .join('/')
}

const FILE_CONTEXTS = new Set([
  'general',
  'knowledge-base',
  'chat',
  'execution',
  'workspace',
  'profile-pictures',
])

export class StorageAccessError extends Error {
  readonly status = 403
  constructor() {
    super('File access denied')
  }
}

/** Validate storage paths and supported contexts before extracting a key. */
export function assertStorageReferenceAccess(value: unknown, context?: unknown): void {
  if (context !== undefined && (typeof context !== 'string' || !FILE_CONTEXTS.has(context)))
    throw new StorageAccessError()
  if (typeof value !== 'string') throw new StorageAccessError()
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new StorageAccessError()
  }
  if (
    decoded.includes(String.fromCharCode(0)) ||
    decoded.includes(String.fromCharCode(92)) ||
    /%(?:2f|5c|00|2e|25)/i.test(decoded) ||
    decoded.toLowerCase().startsWith('file:') ||
    decoded.split(/[/?#]/).some((part) => part === '.' || part === '..')
  )
    throw new StorageAccessError()
}

/** Check every redirect before requesting its body. */
export async function fetchPublicStorageUrl(url: string, init?: RequestInit): Promise<Response> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    assertStorageReferenceAccess(url)
    const response = await fetch(url, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error('File redirect has no location')
    url = new URL(location, url).toString()
  }
  throw new Error('Too many file redirects')
}
