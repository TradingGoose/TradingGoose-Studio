import {
  AZURE_CHAT_CONFIG,
  AZURE_CONFIG,
  AZURE_COPILOT_CONFIG,
  AZURE_EXECUTION_FILES_CONFIG,
  AZURE_KB_CONFIG,
  AZURE_PROFILE_PICTURES_CONFIG,
  S3_CHAT_CONFIG,
  S3_CONFIG,
  S3_COPILOT_CONFIG,
  S3_EXECUTION_FILES_CONFIG,
  S3_KB_CONFIG,
  S3_PROFILE_PICTURES_CONFIG,
  USE_AZURE_STORAGE,
  USE_S3_STORAGE,
  USE_VERCEL_STORAGE,
  VERCEL_BLOB_CONFIG,
  type VercelBlobAccess,
} from '@/lib/uploads/core/setup'

export type StorageContext =
  | 'general'
  | 'knowledge-base'
  | 'chat'
  | 'copilot'
  | 'execution'
  | 'workspace'
  | 'profile-pictures'

export interface StorageConfig {
  // S3 config
  bucket?: string
  region?: string
  // Azure config
  containerName?: string
  accountName?: string
  accountKey?: string
  connectionString?: string
  // Vercel config
  token?: string
  access?: VercelBlobAccess
}

/**
 * Get the appropriate storage configuration for a given context.
 */
export function getStorageConfig(context: StorageContext): StorageConfig {
  if (USE_AZURE_STORAGE) {
    return getAzureConfig(context)
  }

  if (USE_S3_STORAGE) {
    return getS3Config(context)
  }

  if (USE_VERCEL_STORAGE) {
    return getVercelConfig(context)
  }

  // Local storage doesn't need config
  return {}
}

/**
 * Get S3 configuration for a given context
 */
function getS3Config(context: StorageContext): StorageConfig {
  switch (context) {
    case 'knowledge-base':
      return {
        bucket: S3_KB_CONFIG.bucket,
        region: S3_KB_CONFIG.region,
      }
    case 'chat':
      return {
        bucket: S3_CHAT_CONFIG.bucket,
        region: S3_CHAT_CONFIG.region,
      }
    case 'copilot':
      return {
        bucket: S3_COPILOT_CONFIG.bucket,
        region: S3_COPILOT_CONFIG.region,
      }
    case 'execution':
      return {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      }
    case 'workspace':
      // Workspace files use general bucket but with custom key structure
      return {
        bucket: S3_CONFIG.bucket,
        region: S3_CONFIG.region,
      }
    case 'profile-pictures':
      return {
        bucket: S3_PROFILE_PICTURES_CONFIG.bucket,
        region: S3_PROFILE_PICTURES_CONFIG.region,
      }
    default:
      return {
        bucket: S3_CONFIG.bucket,
        region: S3_CONFIG.region,
      }
  }
}

/**
 * Get Azure configuration for a given context
 */
function getAzureConfig(context: StorageContext): StorageConfig {
  switch (context) {
    case 'knowledge-base':
      return {
        accountName: AZURE_KB_CONFIG.accountName,
        accountKey: AZURE_KB_CONFIG.accountKey,
        connectionString: AZURE_KB_CONFIG.connectionString,
        containerName: AZURE_KB_CONFIG.containerName,
      }
    case 'chat':
      return {
        accountName: AZURE_CHAT_CONFIG.accountName,
        accountKey: AZURE_CHAT_CONFIG.accountKey,
        connectionString: AZURE_CHAT_CONFIG.connectionString,
        containerName: AZURE_CHAT_CONFIG.containerName,
      }
    case 'copilot':
      return {
        accountName: AZURE_COPILOT_CONFIG.accountName,
        accountKey: AZURE_COPILOT_CONFIG.accountKey,
        connectionString: AZURE_COPILOT_CONFIG.connectionString,
        containerName: AZURE_COPILOT_CONFIG.containerName,
      }
    case 'execution':
      return {
        accountName: AZURE_EXECUTION_FILES_CONFIG.accountName,
        accountKey: AZURE_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: AZURE_EXECUTION_FILES_CONFIG.connectionString,
        containerName: AZURE_EXECUTION_FILES_CONFIG.containerName,
      }
    case 'workspace':
      // Workspace files use general container but with custom key structure
      return {
        accountName: AZURE_CONFIG.accountName,
        accountKey: AZURE_CONFIG.accountKey,
        connectionString: AZURE_CONFIG.connectionString,
        containerName: AZURE_CONFIG.containerName,
      }
    case 'profile-pictures':
      return {
        accountName: AZURE_PROFILE_PICTURES_CONFIG.accountName,
        accountKey: AZURE_PROFILE_PICTURES_CONFIG.accountKey,
        connectionString: AZURE_PROFILE_PICTURES_CONFIG.connectionString,
        containerName: AZURE_PROFILE_PICTURES_CONFIG.containerName,
      }
    default:
      return {
        accountName: AZURE_CONFIG.accountName,
        accountKey: AZURE_CONFIG.accountKey,
        connectionString: AZURE_CONFIG.connectionString,
        containerName: AZURE_CONFIG.containerName,
      }
  }
}

/**
 * Get Vercel Blob configuration for a given context
 */
function getVercelConfig(_context: StorageContext): StorageConfig {
  return {
    token: VERCEL_BLOB_CONFIG.token,
    access: VERCEL_BLOB_CONFIG.access,
  }
}

/**
 * Check if a specific storage context is configured
 * Returns false if the context would fall back to general config but general isn't configured
 */
export function isStorageContextConfigured(context: StorageContext): boolean {
  const config = getStorageConfig(context)

  if (USE_AZURE_STORAGE) {
    return !!(
      config.containerName &&
      (config.connectionString || (config.accountName && config.accountKey))
    )
  }

  if (USE_S3_STORAGE) {
    return !!(config.bucket && config.region)
  }

  if (USE_VERCEL_STORAGE) {
    return !!config.token
  }

  // Local storage is always available
  return true
}
