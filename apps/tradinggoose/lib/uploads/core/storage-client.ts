import { createLogger } from '@/lib/logs/console/logger'
import { USE_AZURE_STORAGE, USE_S3_STORAGE, USE_VERCEL_STORAGE } from '@/lib/uploads/core/setup'
import { sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('StorageClient')

// Client-safe type definitions
export type FileInfo = {
  path: string
  key: string
  name: string
  size: number
  type: string
}

/**
 * Download a file from the configured storage provider
 * @param key File key/name
 * @returns File buffer
 */
export async function downloadFile(key: string): Promise<Buffer> {
  if (USE_AZURE_STORAGE) {
    logger.info(`Downloading file from Azure storage: ${key}`)
    const { downloadFromAzure } = await import('@/lib/uploads/providers/azure/azure-client')
    return downloadFromAzure(key)
  }

  if (USE_VERCEL_STORAGE) {
    logger.info(`Downloading file from Vercel Blob: ${key}`)
    const { downloadFromVercel } = await import('@/lib/uploads/providers/vercel/vercel-client')
    return downloadFromVercel(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Downloading file from S3: ${key}`)
    const { downloadFromS3 } = await import('@/lib/uploads/providers/s3/s3-client')
    return downloadFromS3(key)
  }

  logger.info(`Downloading file from local storage: ${key}`)
  const { readFile } = await import('fs/promises')
  const { join, resolve, sep } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('@/lib/uploads/core/setup.server')

  const safeKey = key.includes('/')
    ? sanitizeFileKey(key)
    : key.replace(/\.\./g, '').replace(/[/\\]/g, '')
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  const resolvedPath = resolve(filePath)
  const allowedDir = resolve(UPLOAD_DIR_SERVER)
  if (!resolvedPath.startsWith(allowedDir + sep) && resolvedPath !== allowedDir) {
    throw new Error('Invalid file path')
  }

  try {
    return await readFile(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${key}`)
    }
    throw error
  }
}

/**
 * Delete a file from the configured storage provider
 * @param key File key/name
 */
export async function deleteFile(key: string): Promise<void> {
  if (USE_AZURE_STORAGE) {
    logger.info(`Deleting file from Azure storage: ${key}`)
    const { deleteFromAzure } = await import('@/lib/uploads/providers/azure/azure-client')
    return deleteFromAzure(key)
  }

  if (USE_VERCEL_STORAGE) {
    logger.info(`Deleting file from Vercel Blob: ${key}`)
    const { deleteFromVercel } = await import('@/lib/uploads/providers/vercel/vercel-client')
    return deleteFromVercel(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Deleting file from S3: ${key}`)
    const { deleteFromS3 } = await import('@/lib/uploads/providers/s3/s3-client')
    return deleteFromS3(key)
  }

  logger.info(`Deleting file from local storage: ${key}`)
  const { unlink } = await import('fs/promises')
  const { join, resolve, sep } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('@/lib/uploads/core/setup.server')

  const safeKey = key.includes('/')
    ? sanitizeFileKey(key)
    : key.replace(/\.\./g, '').replace(/[/\\]/g, '')
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  const resolvedPath = resolve(filePath)
  const allowedDir = resolve(UPLOAD_DIR_SERVER)
  if (!resolvedPath.startsWith(allowedDir + sep) && resolvedPath !== allowedDir) {
    throw new Error('Invalid file path')
  }

  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn(`File not found during deletion: ${key}`)
      return
    }
    throw error
  }
}

/**
 * Get the appropriate serve path prefix based on storage provider
 */
export function getServePathPrefix(): string {
  if (USE_AZURE_STORAGE) return '/api/files/serve/azure/'
  if (USE_S3_STORAGE) return '/api/files/serve/s3/'
  if (USE_VERCEL_STORAGE) return '/api/files/serve/vercel/'
  return '/api/files/serve/'
}
