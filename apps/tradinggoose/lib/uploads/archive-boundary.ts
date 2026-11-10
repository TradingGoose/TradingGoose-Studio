const PUBLIC_CONTEXTS = new Set([
  'general',
  'knowledge-base',
  'chat',
  'copilot',
  'execution',
  'workspace',
  'profile-pictures',
])
const RESERVED_ARCHIVE = /(?:^|[/_-])archived[-_]enhanced[-_]logs(?:[/_.-]|$)/i

export class ArchiveAccessError extends Error {
  readonly status = 403
  constructor() {
    super('Access denied: workflow archives are available only through authorized Records access')
  }
}

export function assertPublicStorageContext(context: unknown): void {
  if (context !== undefined && (typeof context !== 'string' || !PUBLIC_CONTEXTS.has(context)))
    throw new ArchiveAccessError()
}

/** Classify before normalization can flatten an archive into an ordinary generic filename. */
export function assertPublicStorageInput(
  value: unknown,
  context?: unknown,
  config?: { bucket?: unknown; containerName?: unknown; token?: unknown }
): void {
  assertPublicStorageContext(context)
  if (typeof value !== 'string') throw new ArchiveAccessError()
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new ArchiveAccessError()
  }
  if (
    /\0|\\/.test(decoded) ||
    /%(?:2f|5c|00|2e|25)/i.test(decoded) ||
    decoded.split(/[/?#]/).some((part) => part === '.' || part === '..') ||
    RESERVED_ARCHIVE.test(decoded) ||
    /workflow-archive/i.test(decoded)
  )
    throw new ArchiveAccessError()
  const archiveBucket = process.env.WORKFLOW_ARCHIVE_S3_BUCKET
  const archiveContainer = process.env.WORKFLOW_ARCHIVE_AZURE_CONTAINER
  const archiveAccount = process.env.WORKFLOW_ARCHIVE_AZURE_ACCOUNT
  const archiveOrigin = process.env.WORKFLOW_ARCHIVE_VERCEL_ORIGIN
  const archiveRoot = process.env.WORKFLOW_ARCHIVE_LOCAL_ROOT
  if (
    (archiveBucket && config?.bucket === archiveBucket) ||
    (archiveContainer && config?.containerName === archiveContainer) ||
    (process.env.WORKFLOW_ARCHIVE_VERCEL_TOKEN &&
      config?.token === process.env.WORKFLOW_ARCHIVE_VERCEL_TOKEN)
  )
    throw new ArchiveAccessError()
  if (archiveRoot && decoded.startsWith(archiveRoot)) throw new ArchiveAccessError()
  try {
    const url = new URL(decoded)
    const path = decodeURIComponent(url.pathname)
    if (
      (archiveBucket &&
        (url.hostname === archiveBucket ||
          url.hostname.startsWith(`${archiveBucket}.`) ||
          path.startsWith(`/${archiveBucket}/`))) ||
      (archiveContainer &&
        path.startsWith(`/${archiveContainer}/`) &&
        (!archiveAccount || url.hostname === `${archiveAccount}.blob.core.windows.net`)) ||
      (archiveOrigin && url.origin === new URL(archiveOrigin).origin)
    )
      throw new ArchiveAccessError()
  } catch (error) {
    if (error instanceof ArchiveAccessError) throw error
  }
}

/** Redirects are checked individually; archive capabilities never pass through a proxy fetch. */
export async function fetchPublicStorageUrl(
  url: string,
  init?: RequestInit,
  beforeFetch?: () => Promise<void>
): Promise<Response> {
  let current = url
  for (let redirects = 0; redirects <= 5; redirects++) {
    const { assertStorageReferenceAccess } = await import('@/lib/uploads/source-read-boundary')
    assertStorageReferenceAccess(current)
    await beforeFetch?.()
    init?.signal?.throwIfAborted()
    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error('File redirect has no location')
    current = new URL(location, current).toString()
  }
  throw new Error('Too many file redirects')
}
