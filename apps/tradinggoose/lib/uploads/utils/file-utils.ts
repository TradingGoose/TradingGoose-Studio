import dns from 'node:dns'
import { isIP } from 'node:net'
import {
  DownloadError,
  fetchWithValidatedRedirects,
  validateDownloadUrl,
} from '@ai-sdk/provider-utils'
// The explicit package entry avoids Bun's built-in undici shim, which ignores connector hooks.
import { Agent, fetch as undiciFetch } from 'undici/index.js'

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

// Use the same pinned transport under Node and Bun. A pre-fetch DNS check followed by ordinary
// fetch would resolve twice and allow DNS rebinding; the connector uses these exact records.
const publicFileDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, '')
        try {
          if (!addresses.length) throw new StorageAccessError()
          for (const { address, family } of addresses) {
            if (isIP(address) !== family) throw new StorageAccessError()
            validateDownloadUrl(`http://${family === 6 ? `[${address}]` : address}/`)
          }
        } catch (error) {
          const failure = DownloadError.isInstance(error) ? new StorageAccessError() : error
          callback(failure instanceof Error ? failure : new Error(String(failure)), '')
          return
        }
        if (options.all) callback(null, addresses)
        else callback(null, addresses[0].address, addresses[0].family)
      })
    },
  },
})

/** The SDK validates each redirect; the transport validates DNS when opening the socket. */
export async function fetchPublicStorageUrl(url: string, init?: RequestInit): Promise<Response> {
  assertStorageReferenceAccess(url)
  try {
    return await fetchWithValidatedRedirects({
      url,
      headers: init?.headers,
      abortSignal: init?.signal ?? undefined,
      maxRedirects: 5,
      fetch: (input, options) =>
        undiciFetch(input as string, {
          method: 'GET',
          headers: Object.fromEntries(new Headers(options?.headers)),
          signal: options?.signal,
          redirect: 'manual',
          dispatcher: publicFileDispatcher,
        }) as unknown as Promise<Response>,
    })
  } catch (error) {
    if (DownloadError.isInstance(error)) throw new StorageAccessError()
    if (error instanceof Error && error.cause instanceof StorageAccessError) throw error.cause
    throw error
  }
}
