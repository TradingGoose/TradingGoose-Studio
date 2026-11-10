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
