import { del, get, put } from '@vercel/blob'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { createLogger } from '@/lib/logs/console/logger'
import { VERCEL_BLOB_CONFIG, type VercelBlobAccess } from '@/lib/uploads/core/setup'
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
  preserveKey?: boolean
): Promise<FileInfo>

export async function uploadToVercel(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: CustomVercelConfig | number,
  sizeOrPreserveKey?: number | boolean,
  preserveKey?: boolean
): Promise<FileInfo> {
  const fileSize =
    typeof configOrSize === 'number'
      ? configOrSize
      : typeof sizeOrPreserveKey === 'number'
        ? sizeOrPreserveKey
        : file.length
  const config = typeof configOrSize === 'object' ? getConfig(configOrSize) : getConfig()
  const shouldPreserveKey =
    typeof sizeOrPreserveKey === 'boolean' ? sizeOrPreserveKey : preserveKey ?? false
  const safeFileName = fileName.replace(/\s+/g, '-')
  const pathname = shouldPreserveKey ? fileName : `${Date.now()}-${safeFileName}`

  logger.info(`Uploading file to Vercel Blob: ${pathname}`)

  const blob = await put(pathname, file, {
    access: config.access,
    token: config.token,
    contentType,
    addRandomSuffix: false,
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

export async function downloadFromVercel(key: string): Promise<Buffer>

export async function downloadFromVercel(
  key: string,
  customConfig: CustomVercelConfig
): Promise<Buffer>

export async function downloadFromVercel(
  key: string,
  customConfig?: CustomVercelConfig
): Promise<Buffer> {
  const config = getConfig(customConfig)
  const result = await get(key, {
    access: config.access,
    token: config.token,
  })

  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`File not found in Vercel Blob: ${key}`)
  }

  const arrayBuffer = await new Response(result.stream).arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function deleteFromVercel(key: string): Promise<void>

export async function deleteFromVercel(
  key: string,
  customConfig: CustomVercelConfig
): Promise<void>

export async function deleteFromVercel(
  key: string,
  customConfig?: CustomVercelConfig
): Promise<void> {
  const config = getConfig(customConfig)
  await del(key, { token: config.token })
}

export async function getDownloadUrlWithConfig(
  key: string,
  customConfig: CustomVercelConfig,
  expiresIn = 3600,
  context?: StorageContext
): Promise<string> {
  getConfig(customConfig)
  return buildSignedServeUrl(key, expiresIn, context)
}
