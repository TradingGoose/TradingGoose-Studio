import { del, get, put } from '@vercel/blob'
import { createLogger } from '@/lib/logs/console/logger'
import { assertPublicStorageInput } from '@/lib/uploads/archive-boundary'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { VERCEL_BLOB_CONFIG, type VercelBlobAccess } from '@/lib/uploads/core/setup'
import {
  assertStorageDeleteAccess,
  assertStorageReadAccess,
} from '@/lib/uploads/source-read-boundary'
import { getBaseUrl } from '@/lib/urls/utils'
import { createVercelDownloadToken } from './download-token'

const logger = createLogger('VercelBlobClient')

const SERVER_MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024

export interface FileInfo {
  path: string
  key: string
  name: string
  size: number
  type: string
}

export interface CustomVercelConfig {
  token: string
  access: VercelBlobAccess
}

function getConfig(customConfig?: CustomVercelConfig): CustomVercelConfig {
  const config = customConfig || {
    token: VERCEL_BLOB_CONFIG.token,
    access: VERCEL_BLOB_CONFIG.access,
  }

  if (!config.token) {
    throw new Error(
      'Vercel Blob Storage token is missing. Set BLOB_READ_WRITE_TOKEN or VERCEL_BLOB_READ_WRITE_TOKEN.'
    )
  }

  return config
}

function buildServePath(key: string, context?: string): string {
  const contextSuffix = context ? `?context=${encodeURIComponent(context)}` : ''
  return `/api/files/serve/vercel/${encodeURIComponent(key)}${contextSuffix}`
}

async function buildSignedServeUrl(
  key: string,
  expiresIn: number,
  context?: StorageContext
): Promise<string> {
  const token = await createVercelDownloadToken({ key, context }, expiresIn)
  const url = new URL(`/api/files/serve/vercel/${encodeURIComponent(key)}`, getBaseUrl())
  url.searchParams.set('downloadToken', token)
  return url.toString()
}

export async function uploadToVercel(
  file: Buffer,
  fileName: string,
  contentType: string,
  size?: number,
  preserveKey?: boolean
): Promise<FileInfo>

export async function uploadToVercel(
  file: Buffer,
  fileName: string,
  contentType: string,
  customConfig: CustomVercelConfig,
  size?: number,
  preserveKey?: boolean,
  preventOverwrite?: boolean
): Promise<FileInfo>

export async function uploadToVercel(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: CustomVercelConfig | number,
  sizeOrPreserveKey?: number | boolean,
  preserveKey?: boolean,
  preventOverwrite?: boolean
): Promise<FileInfo> {
  assertPublicStorageInput(
    fileName,
    undefined,
    typeof configOrSize === 'object' ? configOrSize : undefined
  )

  const fileSize =
    typeof configOrSize === 'number'
      ? configOrSize
      : typeof sizeOrPreserveKey === 'number'
        ? sizeOrPreserveKey
        : file.length
  const config = typeof configOrSize === 'object' ? getConfig(configOrSize) : getConfig()
  assertPublicStorageInput(fileName, undefined, config)
  const shouldPreserveKey =
    typeof sizeOrPreserveKey === 'boolean' ? sizeOrPreserveKey : (preserveKey ?? false)
  const safeFileName = fileName.replace(/\s+/g, '-')
  const pathname = shouldPreserveKey ? fileName : `${Date.now()}-${safeFileName}`

  logger.info(`Uploading file to Vercel Blob: ${pathname}`)

  const blob = await put(pathname, file, {
    access: config.access,
    token: config.token,
    contentType,
    addRandomSuffix: false,
    ...(preventOverwrite ? { allowOverwrite: false } : {}),
    multipart: fileSize > SERVER_MULTIPART_THRESHOLD_BYTES,
  })

  return {
    path: buildServePath(blob.pathname),
    key: blob.pathname,
    name: fileName,
    size: fileSize,
    type: contentType,
  }
}

export async function downloadFromVercel(
  key: string,
  customConfig?: CustomVercelConfig,
  signal?: AbortSignal
): Promise<Buffer> {
  signal?.throwIfAborted()
  assertStorageReadAccess(key, undefined, customConfig, 'vercel')

  const config = getConfig(customConfig)
  assertStorageReadAccess(key, undefined, config, 'vercel')
  const result = await get(key, {
    access: config.access,
    token: config.token,
    abortSignal: signal,
  })

  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`File not found in Vercel Blob: ${key}`)
  }

  const reader = result.stream.getReader()
  let cancellation: Promise<void> | undefined
  const abort = () => {
    cancellation = reader.cancel(signal?.reason)
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    const chunks: Uint8Array[] = []
    while (true) {
      const part = await reader.read()
      signal?.throwIfAborted()
      if (part.done) return Buffer.concat(chunks)
      chunks.push(part.value)
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    try {
      await (cancellation ?? reader.cancel())
    } finally {
      reader.releaseLock()
    }
  }
}

export async function deleteFromVercel(key: string): Promise<void>

export async function deleteFromVercel(key: string, customConfig: CustomVercelConfig): Promise<void>

export async function deleteFromVercel(
  key: string,
  customConfig?: CustomVercelConfig
): Promise<void> {
  assertStorageDeleteAccess(key, undefined, customConfig, 'vercel')

  const config = getConfig(customConfig)
  assertStorageDeleteAccess(key, undefined, config, 'vercel')
  await del(key, { token: config.token })
}

export async function getDownloadUrlWithConfig(
  key: string,
  customConfig: CustomVercelConfig,
  expiresIn = 3600,
  context?: StorageContext
): Promise<string> {
  assertStorageReadAccess(key, context, customConfig, 'vercel')

  assertStorageReadAccess(key, context, getConfig(customConfig), 'vercel')
  return buildSignedServeUrl(key, expiresIn, context)
}
