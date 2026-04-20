import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import path, { join } from 'path'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getStorageProvider,
  USE_AZURE_STORAGE,
  USE_LOCAL_STORAGE,
  USE_S3_STORAGE,
  USE_VERCEL_STORAGE,
} from '@/lib/uploads/core/setup'

const logger = createLogger('UploadsSetup')

// Server-only upload directory path
const PROJECT_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd())
export const UPLOAD_DIR_SERVER = join(PROJECT_ROOT, 'uploads')

/**
 * Server-only function to ensure uploads directory exists
 */
export async function ensureUploadsDirectory() {
  if (USE_S3_STORAGE) {
    logger.info('Using S3 storage, skipping local uploads directory creation')
    return true
  }

  if (USE_AZURE_STORAGE) {
    logger.info('Using Azure storage, skipping local uploads directory creation')
    return true
  }

  if (USE_VERCEL_STORAGE) {
    logger.info('Using Vercel Blob storage, skipping local uploads directory creation')
    return true
  }

  try {
    if (!existsSync(UPLOAD_DIR_SERVER)) {
      await mkdir(UPLOAD_DIR_SERVER, { recursive: true })
    } else {
      logger.info(`Uploads directory already exists at ${UPLOAD_DIR_SERVER}`)
    }
    return true
  } catch (error) {
    logger.error('Failed to create uploads directory:', error)
    return false
  }
}

// Immediately invoke on server startup
if (typeof process !== 'undefined') {
  const storageProvider = getStorageProvider()

  // Log storage mode
  logger.info(`Storage provider: ${storageProvider}`)

  if (USE_AZURE_STORAGE) {
    // Verify Azure credentials
    if (!env.AZURE_STORAGE_CONTAINER_NAME) {
      logger.warn('Azure storage is enabled but AZURE_STORAGE_CONTAINER_NAME is not set')
    } else if (!env.AZURE_ACCOUNT_NAME && !env.AZURE_CONNECTION_STRING) {
      logger.warn(
        'Azure storage is enabled but neither AZURE_ACCOUNT_NAME nor AZURE_CONNECTION_STRING is set'
      )
      logger.warn(
        'Set AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY or AZURE_CONNECTION_STRING for Azure storage'
      )
    } else if (env.AZURE_ACCOUNT_NAME && !env.AZURE_ACCOUNT_KEY && !env.AZURE_CONNECTION_STRING) {
      logger.warn(
        'AZURE_ACCOUNT_NAME is set but AZURE_ACCOUNT_KEY is missing and no AZURE_CONNECTION_STRING provided'
      )
      logger.warn('Set AZURE_ACCOUNT_KEY or use AZURE_CONNECTION_STRING for authentication')
    } else {
      logger.info('Azure storage credentials found in environment variables')
      if (env.AZURE_CONNECTION_STRING) {
        logger.info('Using Azure connection string for authentication')
      } else {
        logger.info('Using Azure account name and key for authentication')
      }
    }
  } else if (USE_VERCEL_STORAGE) {
    if (!env.BLOB_READ_WRITE_TOKEN && !env.VERCEL_BLOB_READ_WRITE_TOKEN) {
      logger.warn(
        'Vercel Blob storage is enabled but no token was found. Set BLOB_READ_WRITE_TOKEN or VERCEL_BLOB_READ_WRITE_TOKEN.'
      )
    } else {
      logger.info('Vercel Blob storage token found in environment variables')
      logger.info(`Using Vercel Blob access mode: ${env.VERCEL_BLOB_ACCESS || 'private'}`)
    }
  } else if (USE_S3_STORAGE) {
    // Verify AWS credentials
    if (!env.S3_BUCKET_NAME || !env.AWS_REGION) {
      logger.warn('S3 storage configuration is incomplete')
      logger.warn('Set S3_BUCKET_NAME and AWS_REGION for S3 storage')
    } else if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      logger.warn('AWS credentials are not set in environment variables')
      logger.warn('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for S3 storage')
    } else {
      logger.info('AWS S3 credentials found in environment variables')
    }
  } else if (USE_LOCAL_STORAGE) {
    // Local storage mode
    logger.info('Using local file storage')

    // Only initialize local uploads directory when using local storage
    ensureUploadsDirectory().then((success) => {
      if (success) {
        logger.info('Local uploads directory initialized')
      } else {
        logger.error('Failed to initialize local uploads directory')
      }
    })
  }

  // Log additional configuration details
  if (USE_AZURE_STORAGE && env.AZURE_STORAGE_KB_CONTAINER_NAME) {
    logger.info(`Azure knowledge base container: ${env.AZURE_STORAGE_KB_CONTAINER_NAME}`)
  }
  if (USE_AZURE_STORAGE && env.AZURE_STORAGE_COPILOT_CONTAINER_NAME) {
    logger.info(`Azure copilot container: ${env.AZURE_STORAGE_COPILOT_CONTAINER_NAME}`)
  }
  if (USE_S3_STORAGE && env.S3_KB_BUCKET_NAME) {
    logger.info(`S3 knowledge base bucket: ${env.S3_KB_BUCKET_NAME}`)
  }
  if (USE_S3_STORAGE && env.S3_COPILOT_BUCKET_NAME) {
    logger.info(`S3 copilot bucket: ${env.S3_COPILOT_BUCKET_NAME}`)
  }
}

export default ensureUploadsDirectory
