import {
  BlobSASPermissions,
  BlobServiceClient,
  type BlockBlobClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from '@azure/storage-blob'
import { createLogger } from '@/lib/logs/console/logger'
import { AZURE_CONFIG } from '@/lib/uploads/core/setup'

const logger = createLogger('AzureClient')

// Lazily create a single Blob service client instance.
let _azureServiceClient: BlobServiceClient | null = null

export function getAzureServiceClient(): BlobServiceClient {
  if (_azureServiceClient) return _azureServiceClient

  const { accountName, accountKey, connectionString } = AZURE_CONFIG

  if (connectionString) {
    // Use connection string if provided
    _azureServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  } else if (accountName && accountKey) {
    // Use account name and key
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey)
    _azureServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      sharedKeyCredential
    )
  } else {
    throw new Error(
      'Azure storage credentials are missing – set AZURE_STORAGE_CONNECTION_STRING or both AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY in your environment.'
    )
  }

  return _azureServiceClient
}

/**
 * Sanitize a filename for use in Azure metadata headers.
 * Azure metadata headers must contain only ASCII printable characters
 * and cannot contain certain special characters
 */
export function sanitizeFilenameForMetadata(filename: string): string {
  return (
    filename
      // Remove non-ASCII characters (keep only printable ASCII 0x20-0x7E)
      .replace(/[^\x20-\x7E]/g, '')
      // Remove characters that are problematic in HTTP headers
      .replace(/["\\]/g, '')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim() ||
    // Provide fallback if completely sanitized
    'file'
  )
}

/**
 * File information structure
 */
export interface FileInfo {
  path: string // Path to access the file
  key: string // Azure key or local filename
  name: string // Original filename
  size: number // File size in bytes
  type: string // MIME type
}

/**
 * Custom Azure configuration
 */
export interface CustomAzureConfig {
  containerName: string
  accountName: string
  accountKey?: string
  connectionString?: string
}

/**
 * Upload a file to Azure storage
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadToAzure(
  file: Buffer,
  fileName: string,
  contentType: string,
  size?: number
): Promise<FileInfo>

/**
 * Upload a file to Azure storage with custom container configuration
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param customConfig Custom Azure configuration (container and account info)
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadToAzure(
  file: Buffer,
  fileName: string,
  contentType: string,
  customConfig: CustomAzureConfig,
  size?: number
): Promise<FileInfo>

export async function uploadToAzure(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: CustomAzureConfig | number,
  size?: number
): Promise<FileInfo> {
  // Handle overloaded parameters
  let config: CustomAzureConfig
  let fileSize: number

  if (typeof configOrSize === 'object') {
    // Custom config provided
    config = configOrSize
    fileSize = size ?? file.length
  } else {
    // Use default config
    config = {
      containerName: AZURE_CONFIG.containerName,
      accountName: AZURE_CONFIG.accountName,
      accountKey: AZURE_CONFIG.accountKey,
      connectionString: AZURE_CONFIG.connectionString,
    }
    fileSize = configOrSize ?? file.length
  }

  const safeFileName = fileName.replace(/\s+/g, '-') // Replace spaces with hyphens
  const uniqueKey = `${Date.now()}-${safeFileName}`

  const azureServiceClient = getAzureServiceClient()
  const containerClient = azureServiceClient.getContainerClient(config.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(uniqueKey)

  await blockBlobClient.upload(file, fileSize, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
    metadata: {
      originalName: encodeURIComponent(fileName), // Encode filename to prevent invalid characters in HTTP headers
      uploadedAt: new Date().toISOString(),
    },
  })

  const servePath = `/api/files/serve/azure/${encodeURIComponent(uniqueKey)}`

  return {
    path: servePath,
    key: uniqueKey,
    name: fileName, // Return the actual original filename in the response
    size: fileSize,
    type: contentType,
  }
}

/**
 * Generate a presigned URL for direct file access
 * @param key File key
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600) {
  const azureServiceClient = getAzureServiceClient()
  const containerClient = azureServiceClient.getContainerClient(AZURE_CONFIG.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  const sasOptions = {
    containerName: AZURE_CONFIG.containerName,
    blobName: key,
    permissions: BlobSASPermissions.parse('r'), // Read permission
    startsOn: new Date(),
    expiresOn: new Date(Date.now() + expiresIn * 1000),
  }

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    new StorageSharedKeyCredential(
      AZURE_CONFIG.accountName,
      AZURE_CONFIG.accountKey ??
        (() => {
          throw new Error('AZURE_ACCOUNT_KEY is required when using account name authentication')
        })()
    )
  ).toString()

  return `${blockBlobClient.url}?${sasToken}`
}

/**
 * Generate a presigned URL for direct file access with custom container
 * @param key File key
 * @param customConfig Custom Azure configuration
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: CustomAzureConfig,
  expiresIn = 3600
) {
  let tempAzureServiceClient: BlobServiceClient

  if (customConfig.connectionString) {
    tempAzureServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
  } else if (customConfig.accountName && customConfig.accountKey) {
    const sharedKeyCredential = new StorageSharedKeyCredential(
      customConfig.accountName,
      customConfig.accountKey
    )
    tempAzureServiceClient = new BlobServiceClient(
      `https://${customConfig.accountName}.blob.core.windows.net`,
      sharedKeyCredential
    )
  } else {
    throw new Error(
      'Custom Azure config must include either connectionString or accountName + accountKey'
    )
  }

  const containerClient = tempAzureServiceClient.getContainerClient(customConfig.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  const sasOptions = {
    containerName: customConfig.containerName,
    blobName: key,
    permissions: BlobSASPermissions.parse('r'), // Read permission
    startsOn: new Date(),
    expiresOn: new Date(Date.now() + expiresIn * 1000),
  }

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    new StorageSharedKeyCredential(
      customConfig.accountName,
      customConfig.accountKey ??
        (() => {
          throw new Error('Account key is required when using account name authentication')
        })()
    )
  ).toString()

  return `${blockBlobClient.url}?${sasToken}`
}

/**
 * Download a file from Azure storage
 * @param key File key
 * @returns File buffer
 */
export async function downloadFromAzure(key: string): Promise<Buffer>

/**
 * Download a file from Azure storage with custom configuration
 * @param key File key
 * @param customConfig Custom Azure configuration
 * @returns File buffer
 */
export async function downloadFromAzure(key: string, customConfig: CustomAzureConfig): Promise<Buffer>

export async function downloadFromAzure(
  key: string,
  customConfig?: CustomAzureConfig
): Promise<Buffer> {
  let azureServiceClient: BlobServiceClient
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      azureServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      azureServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom Azure configuration')
    }
    containerName = customConfig.containerName
  } else {
    azureServiceClient = getAzureServiceClient()
    containerName = AZURE_CONFIG.containerName
  }

  const containerClient = azureServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  const downloadBlockBlobResponse = await blockBlobClient.download()
  if (!downloadBlockBlobResponse.readableStreamBody) {
    throw new Error('Failed to get readable stream from Azure download')
  }
  const downloaded = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody)

  return downloaded
}

/**
 * Delete a file from Azure storage
 * @param key File key
 */
export async function deleteFromAzure(key: string): Promise<void>

/**
 * Delete a file from Azure storage with custom configuration
 * @param key File key
 * @param customConfig Custom Azure configuration
 */
export async function deleteFromAzure(key: string, customConfig: CustomAzureConfig): Promise<void>

export async function deleteFromAzure(key: string, customConfig?: CustomAzureConfig): Promise<void> {
  let azureServiceClient: BlobServiceClient
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      azureServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      azureServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom Azure configuration')
    }
    containerName = customConfig.containerName
  } else {
    azureServiceClient = getAzureServiceClient()
    containerName = AZURE_CONFIG.containerName
  }

  const containerClient = azureServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  await blockBlobClient.delete()
}

/**
 * Helper function to convert a readable stream to a Buffer
 */
async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data))
    })
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    readableStream.on('error', reject)
  })
}

// Multipart upload interfaces
export interface AzureMultipartUploadInit {
  fileName: string
  contentType: string
  fileSize: number
  customConfig?: CustomAzureConfig
}

export interface AzureMultipartUploadResult {
  uploadId: string
  key: string
  blockBlobClient: BlockBlobClient
}

export interface AzurePartUploadUrl {
  partNumber: number
  blockId: string
  url: string
}

export interface AzureMultipartPart {
  blockId: string
  partNumber: number
}

/**
 * Initiate a multipart upload for Azure storage
 */
export async function initiateMultipartUpload(
  options: AzureMultipartUploadInit
): Promise<{ uploadId: string; key: string }> {
  const { fileName, contentType, customConfig } = options

  let azureServiceClient: BlobServiceClient
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      azureServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      azureServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom Azure configuration')
    }
    containerName = customConfig.containerName
  } else {
    azureServiceClient = getAzureServiceClient()
    containerName = AZURE_CONFIG.containerName
  }

  // Create unique key for the blob
  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  const { v4: uuidv4 } = await import('uuid')
  const uniqueKey = `kb/${uuidv4()}-${safeFileName}`

  // Generate a unique upload ID (Azure doesn't have native multipart like S3)
  const uploadId = uuidv4()

  // Store the blob client reference for later use (in a real implementation, you'd use Redis or similar)
  const containerClient = azureServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(uniqueKey)

  // Set metadata to track the multipart upload
  await blockBlobClient.setMetadata({
    uploadId,
    fileName: encodeURIComponent(fileName),
    contentType,
    uploadStarted: new Date().toISOString(),
    multipartUpload: 'true',
  })

  return {
    uploadId,
    key: uniqueKey,
  }
}

/**
 * Generate presigned URLs for uploading parts
 */
export async function getMultipartPartUrls(
  key: string,
  _uploadId: string, // Not used in Azure multipart flow, kept for interface consistency
  partNumbers: number[],
  customConfig?: CustomAzureConfig
): Promise<AzurePartUploadUrl[]> {
  let azureServiceClient: BlobServiceClient
  let containerName: string
  let accountName: string
  let accountKey: string

  if (customConfig) {
    if (customConfig.connectionString) {
      azureServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
      // Extract account name from connection string
      const match = customConfig.connectionString.match(/AccountName=([^;]+)/)
      if (!match) throw new Error('Cannot extract account name from connection string')
      accountName = match[1]

      const keyMatch = customConfig.connectionString.match(/AccountKey=([^;]+)/)
      if (!keyMatch) throw new Error('Cannot extract account key from connection string')
      accountKey = keyMatch[1]
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      azureServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
      accountName = customConfig.accountName
      accountKey = customConfig.accountKey
    } else {
      throw new Error('Invalid custom Azure configuration')
    }
    containerName = customConfig.containerName
  } else {
    azureServiceClient = getAzureServiceClient()
    containerName = AZURE_CONFIG.containerName
    accountName = AZURE_CONFIG.accountName
    accountKey =
      AZURE_CONFIG.accountKey ||
      (() => {
        throw new Error('AZURE_ACCOUNT_KEY is required')
      })()
  }

  const containerClient = azureServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  return partNumbers.map((partNumber) => {
    // Azure uses block IDs instead of part numbers
    // Block IDs must be base64 encoded and all the same length
    const blockId = Buffer.from(`block-${partNumber.toString().padStart(6, '0')}`).toString(
      'base64'
    )

    // Generate SAS token for uploading this specific block
    const sasOptions = {
      containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse('w'), // Write permission
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + 3600 * 1000), // 1 hour
    }

    const sasToken = generateBlobSASQueryParameters(
      sasOptions,
      new StorageSharedKeyCredential(accountName, accountKey)
    ).toString()

    return {
      partNumber,
      blockId,
      url: `${blockBlobClient.url}?comp=block&blockid=${encodeURIComponent(blockId)}&${sasToken}`,
    }
  })
}

/**
 * Complete multipart upload by committing all blocks
 */
export async function completeMultipartUpload(
  key: string,
  _uploadId: string, // Not used in Azure multipart flow, kept for interface consistency
  parts: Array<{ blockId: string; partNumber: number }>,
  customConfig?: CustomAzureConfig
): Promise<{ location: string; path: string; key: string }> {
  let azureServiceClient: BlobServiceClient
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      azureServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      azureServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom Azure configuration')
    }
    containerName = customConfig.containerName
  } else {
    azureServiceClient = getAzureServiceClient()
    containerName = AZURE_CONFIG.containerName
  }

  const containerClient = azureServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  // Sort parts by part number and extract block IDs
  const sortedBlockIds = parts
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((part) => part.blockId)

  // Commit the block list to create the final blob
  await blockBlobClient.commitBlockList(sortedBlockIds, {
    metadata: {
      multipartUpload: 'completed',
      uploadCompletedAt: new Date().toISOString(),
    },
  })

  const location = blockBlobClient.url
  const path = `/api/files/serve/azure/${encodeURIComponent(key)}`

  return {
    location,
    path,
    key,
  }
}

/**
 * Abort multipart upload by deleting the blob if it exists
 */
export async function abortMultipartUpload(
  key: string,
  _uploadId: string, // Not used in Azure multipart flow, kept for interface consistency
  customConfig?: CustomAzureConfig
): Promise<void> {
  let azureServiceClient: BlobServiceClient
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      azureServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      azureServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom Azure configuration')
    }
    containerName = customConfig.containerName
  } else {
    azureServiceClient = getAzureServiceClient()
    containerName = AZURE_CONFIG.containerName
  }

  const containerClient = azureServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  try {
    // Delete the blob if it exists (this also cleans up any uncommitted blocks)
    await blockBlobClient.deleteIfExists()
  } catch (error) {
    // Ignore errors since we're just cleaning up
    logger.warn('Error cleaning up multipart upload:', error)
  }
}
