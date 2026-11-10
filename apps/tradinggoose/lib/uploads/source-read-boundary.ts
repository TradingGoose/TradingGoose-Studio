import { AsyncLocalStorage } from 'node:async_hooks'
import { realpathSync } from 'node:fs'
import { BlobServiceClient } from '@azure/storage-blob'
import { assertPublicStorageInput } from '@/lib/uploads/archive-boundary'
import {
  getStorageConfig,
  type StorageConfig,
  type StorageContext,
} from '@/lib/uploads/core/config-resolver'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/local-path'
import { getStorageProvider, type StorageProvider } from '@/lib/uploads/core/setup'

export class PrivateSourceAccessError extends Error {
  readonly status = 403
  constructor() {
    super('File access is unavailable: use an authorized workspace file or upload the image again')
  }
}

type StoragePurpose = 'read' | 'delete'
const authorizedStorageOperation = new AsyncLocalStorage<{
  key: string
  destination: string
  purpose: StoragePurpose
}>()

export class PrivateSourceMutationError extends Error {
  readonly status = 403
  constructor() {
    super('File deletion is unavailable without current canonical ownership and delete permission')
  }
}

function localRoot() {
  const root = UPLOAD_DIR_SERVER
  try {
    return realpathSync(root)
  } catch {
    return root
  }
}

/** No IO: the public SDK resolves connection-string endpoints with its actual precedence. */
function azureContainer(config: StorageConfig): URL | null {
  try {
    if (!config.containerName) return null
    const service = config.connectionString
      ? BlobServiceClient.fromConnectionString(config.connectionString)
      : config.accountName
        ? new BlobServiceClient(`https://${config.accountName}.blob.core.windows.net`)
        : null
    return service ? new URL(service.getContainerClient(config.containerName).url) : null
  } catch {
    return null
  }
}

function destination(provider: StorageProvider, config: StorageConfig): string | null {
  switch (provider) {
    case 's3':
      return config.bucket ? `s3:${config.bucket.toLowerCase()}` : null
    case 'azure': {
      const container = azureContainer(config)
      return container
        ? `azure:${container.hostname}${container.pathname.replace(/\/$/, '')}`
        : null
    }
    case 'vercel':
      // A different token is not evidence of a different physical store.
      return 'vercel:shared'
    case 'local':
      return `local:${localRoot()}`
  }
}

/** Internal server capability. Issuers must first verify a source proof or a canonical row. */
export function withAuthorizedStorageRead<T>(
  key: string,
  context: StorageContext,
  action: () => T
): T {
  assertPublicStorageInput(key, context)
  const target = destination(getStorageProvider(), getStorageConfig(context))
  if (!target) throw new PrivateSourceAccessError()
  return authorizedStorageOperation.run({ key, destination: target, purpose: 'read' }, action)
}

/** Internal DELETE purpose; only fresh canonical writers or actual new-copy rollback may issue it. */
export function withAuthorizedStorageDelete<T>(
  key: string,
  context: StorageContext,
  action: () => T
): T {
  assertPublicStorageInput(key, context)
  const target = destination(getStorageProvider(), getStorageConfig(context))
  if (!target) throw new PrivateSourceMutationError()
  return authorizedStorageOperation.run({ key, destination: target, purpose: 'delete' }, action)
}

function requireAuthorization(
  key: string,
  target: string | null,
  purpose: StoragePurpose = 'read'
) {
  const authority = authorizedStorageOperation.getStore()
  if (
    !target ||
    authority?.key !== key ||
    authority.destination !== target ||
    authority.purpose !== purpose
  ) {
    if (purpose === 'delete') throw new PrivateSourceMutationError()
    throw new PrivateSourceAccessError()
  }
}

/** Destination exclusion supplements each caller's real mutation policy; read scope never grants DELETE. */
export function assertStorageDeleteAccess(
  key: string,
  context?: StorageContext,
  config?: StorageConfig,
  provider: StorageProvider = getStorageProvider()
): void {
  assertPublicStorageInput(key, context, config)
  const protectedTarget = destination(provider, getStorageConfig('copilot'))
  const target = destination(provider, config ?? getStorageConfig(context ?? 'general'))
  if (!protectedTarget || !target || target === protectedTarget)
    requireAuthorization(key, target, 'delete')
}

/** Provider keys are always object keys, even if they happen to look like public URLs. */
export function assertStorageReadAccess(
  key: string,
  context?: StorageContext,
  config?: StorageConfig,
  provider: StorageProvider = getStorageProvider()
): void {
  assertPublicStorageInput(key, context, config)
  const protectedTarget = destination(provider, getStorageConfig('copilot'))
  const target = destination(provider, config ?? getStorageConfig(context ?? 'general'))
  if (!protectedTarget || !target || target === protectedTarget) requireAuthorization(key, target)
}

/** Raw keys, caller contexts and old generic signed URLs never confer private-source ownership. */
function assertStorageReferenceOperation(
  value: string,
  purpose: StoragePurpose,
  context?: StorageContext,
  config?: StorageConfig,
  provider: StorageProvider = getStorageProvider()
): void {
  const assertKey = purpose === 'delete' ? assertStorageDeleteAccess : assertStorageReadAccess
  const denied = () =>
    purpose === 'delete' ? new PrivateSourceMutationError() : new PrivateSourceAccessError()
  assertPublicStorageInput(value, context, config)
  const decoded = decodeURIComponent(value)
  const protectedConfig = getStorageConfig('copilot')
  let url: URL | undefined
  try {
    url = new URL(decoded)
  } catch {
    // Relative serve aliases use the same selected configuration as their route.
  }
  const pathname = url?.pathname ?? decoded.split('?')[0]
  const serve = pathname.match(/^\/api\/files\/serve\/(?:s3\/|azure\/|vercel\/)?(.+)$/)
  if (serve) {
    const params = new URLSearchParams(url?.search ?? decoded.split('?')[1])
    const aliasContext = params.get('context') ?? context ?? 'general'
    assertPublicStorageInput(serve[1], aliasContext)
    assertKey(serve[1], aliasContext as StorageContext, undefined, provider)
    return
  }
  if (url) {
    if (provider === 's3') {
      const bucket = protectedConfig.bucket?.toLowerCase()
      if (
        (!bucket &&
          (url.protocol === 's3:' ||
            /(?:^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/i.test(url.hostname))) ||
        url.hostname === bucket ||
        url.hostname.startsWith(`${bucket}.`) ||
        (Boolean(bucket) && pathname.startsWith(`/${bucket}/`))
      )
        throw denied()
    } else if (provider === 'azure') {
      const container = azureContainer(protectedConfig)
      if (
        (!container && /(?:^|\.)blob\.core\.[a-z.]+$/i.test(url.hostname)) ||
        (container &&
          url.hostname === container.hostname &&
          (pathname === container.pathname || pathname.startsWith(`${container.pathname}/`)))
      )
        throw denied()
    } else if (provider === 'vercel' && /(?:^|\.)blob\.vercel-storage\.com$/i.test(url.hostname)) {
      throw denied()
    }
    if (url.protocol === 'file:' || /^\/uploads(?:\/|$)/.test(pathname)) throw denied()
    return
  }
  assertKey(decoded, context, config, provider)
}

export function assertStorageReferenceAccess(
  value: string,
  context?: StorageContext,
  config?: StorageConfig,
  provider: StorageProvider = getStorageProvider()
): void {
  assertStorageReferenceOperation(value, 'read', context, config, provider)
}

export function assertStorageDeleteReferenceAccess(
  value: string,
  context?: StorageContext,
  config?: StorageConfig,
  provider: StorageProvider = getStorageProvider()
): void {
  assertStorageReferenceOperation(value, 'delete', context, config, provider)
}
