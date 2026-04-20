import { env } from '@/lib/env'

// Client-safe configuration - no Node.js modules
export const UPLOAD_DIR = '/uploads'

export type StorageProvider = 'local' | 's3' | 'azure' | 'vercel'
export type VercelBlobAccess = 'public' | 'private'

// Check if S3 is configured (has required credentials)
const hasS3Config = !!(env.S3_BUCKET_NAME && env.AWS_REGION)

// Check if Azure storage is configured (has required credentials)
const hasAzureConfig = !!(
  env.AZURE_STORAGE_CONTAINER_NAME &&
  ((env.AZURE_ACCOUNT_NAME && env.AZURE_ACCOUNT_KEY) || env.AZURE_CONNECTION_STRING)
)

// Check if Vercel Blob is configured
const hasVercelConfig = !!(env.VERCEL_BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN)

function normalizeRequestedStorageProvider(value: string | undefined): StorageProvider | null {
  switch (value?.toLowerCase()) {
    case 'local':
      return 'local'
    case 's3':
      return 's3'
    case 'azure':
      return 'azure'
    case 'vercel':
      return 'vercel'
    default:
      return null
  }
}

function resolveStorageProvider(): StorageProvider {
  const requestedProvider = normalizeRequestedStorageProvider(env.STORAGE_PROVIDER)

  if (requestedProvider === 'local') return 'local'
  if (requestedProvider === 'azure') {
    if (hasAzureConfig) return 'azure'
    throw new Error(
      'STORAGE_PROVIDER=azure requires AZURE_STORAGE_CONTAINER_NAME and either AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY.'
    )
  }
  if (requestedProvider === 's3') {
    if (hasS3Config) return 's3'
    throw new Error('STORAGE_PROVIDER=s3 requires S3_BUCKET_NAME and AWS_REGION.')
  }
  if (requestedProvider === 'vercel') {
    if (hasVercelConfig) return 'vercel'
    throw new Error(
      'STORAGE_PROVIDER=vercel requires BLOB_READ_WRITE_TOKEN or VERCEL_BLOB_READ_WRITE_TOKEN.'
    )
  }

  // Preserve existing implicit preference order for current deployments.
  if (hasAzureConfig) return 'azure'
  if (hasS3Config) return 's3'
  if (hasVercelConfig) return 'vercel'
  return 'local'
}

export const STORAGE_PROVIDER = resolveStorageProvider()
export const USE_LOCAL_STORAGE = STORAGE_PROVIDER === 'local'
export const USE_AZURE_STORAGE = STORAGE_PROVIDER === 'azure'
export const USE_S3_STORAGE = STORAGE_PROVIDER === 's3'
export const USE_VERCEL_STORAGE = STORAGE_PROVIDER === 'vercel'

export const S3_CONFIG = {
  bucket: env.S3_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const AZURE_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_CONTAINER_NAME || '',
}

export const S3_KB_CONFIG = {
  bucket: env.S3_KB_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const S3_EXECUTION_FILES_CONFIG = {
  bucket: env.S3_EXECUTION_FILES_BUCKET_NAME || 'tradinggoose-execution-files',
  region: env.AWS_REGION || '',
}

export const AZURE_KB_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_KB_CONTAINER_NAME || '',
}

export const AZURE_EXECUTION_FILES_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME || 'tradinggoose-execution-files',
}

export const S3_CHAT_CONFIG = {
  bucket: env.S3_CHAT_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const AZURE_CHAT_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_CHAT_CONTAINER_NAME || '',
}

export const S3_COPILOT_CONFIG = {
  bucket: env.S3_COPILOT_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const AZURE_COPILOT_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_COPILOT_CONTAINER_NAME || '',
}

export const S3_PROFILE_PICTURES_CONFIG = {
  bucket: env.S3_PROFILE_PICTURES_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const AZURE_PROFILE_PICTURES_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME || '',
}

/**
 * Shared Vercel Blob configuration.
 */
export const VERCEL_BLOB_CONFIG = {
  token: env.VERCEL_BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN || '',
  access: (env.VERCEL_BLOB_ACCESS || 'private') as VercelBlobAccess,
}

/**
 * Get the current storage provider identifier.
 */
export function getStorageProvider(): StorageProvider {
  return STORAGE_PROVIDER
}

/**
 * Check if we're using any cloud storage (S3, Azure, or Vercel)
 */
export function isUsingCloudStorage(): boolean {
  return !USE_LOCAL_STORAGE
}
