import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for storage service provider behavior
 *
 * @vitest-environment node
 */

describe('storage-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doUnmock('@/lib/uploads/core/config-resolver')
  })

  it.each([
    ['s3', 'profile-pictures'],
    ['azure', 'chat'],
    ['vercel', 'workspace'],
  ] as const)(
    'returns the %s upload path for the %s storage context',
    async (provider, context) => {
      const key = 'folder/image.png'
      const path = `/api/files/serve/${provider}/${encodeURIComponent(key)}`
      const upload = vi.fn().mockResolvedValue({ path, key })
      vi.doMock('@/lib/uploads/core/setup', () => ({
        USE_S3_STORAGE: provider === 's3',
        USE_AZURE_STORAGE: provider === 'azure',
        USE_VERCEL_STORAGE: provider === 'vercel',
      }))
      const getStorageConfig = vi.fn().mockReturnValue({
        bucket: 'images',
        containerName: 'images',
        token: 'token',
      })
      vi.doMock('@/lib/uploads/core/config-resolver', () => ({ getStorageConfig }))
      vi.doMock('@/lib/uploads/providers/s3/s3-client', () => ({ uploadToS3: upload }))
      vi.doMock('@/lib/uploads/providers/azure/azure-client', () => ({ uploadToAzure: upload }))
      vi.doMock('@/lib/uploads/providers/vercel/vercel-client', () => ({ uploadToVercel: upload }))

      const { uploadFile } = await import('./storage-service')
      const result = await uploadFile({
        file: Buffer.from('image'),
        fileName: 'image.png',
        contentType: 'image/png',
        context,
      })
      expect(getStorageConfig).toHaveBeenCalledWith(context)
      expect(result.path).toBe(`${path}?context=${context}`)
    }
  )

  it.each(['s3', 'azure', 'vercel'] as const)(
    'deletes generated execution files through the configured %s storage scope',
    async (provider) => {
      const remove = vi.fn().mockResolvedValue(undefined)
      vi.doMock('@/lib/uploads/core/setup', () => ({
        USE_AZURE_STORAGE: provider === 'azure',
        USE_S3_STORAGE: provider === 's3',
        USE_VERCEL_STORAGE: provider === 'vercel',
        S3_CONFIG: { bucket: 'general-bucket', region: 'general-region' },
        S3_EXECUTION_FILES_CONFIG: { bucket: 'execution-bucket', region: 'execution-region' },
        AZURE_CONFIG: { containerName: 'general-container', accountName: 'general-account' },
        AZURE_EXECUTION_FILES_CONFIG: {
          containerName: 'execution-container',
          accountName: 'execution-account',
          accountKey: 'execution-key',
        },
        VERCEL_BLOB_CONFIG: { token: 'execution-token', access: 'private' },
      }))
      vi.doMock('@/lib/uploads/providers/s3/s3-client', () => ({ deleteFromS3: remove }))
      vi.doMock('@/lib/uploads/providers/azure/azure-client', () => ({ deleteFromAzure: remove }))
      vi.doMock('@/lib/uploads/providers/vercel/vercel-client', () => ({
        deleteFromVercel: remove,
      }))
      const { deleteFile } = await import('./storage-service')
      const key = 'workspace/workflow/execution/report.pdf'
      await deleteFile({ key, context: 'execution' })
      const config = {
        s3: { bucket: 'execution-bucket', region: 'execution-region' },
        azure: {
          containerName: 'execution-container',
          accountName: 'execution-account',
          accountKey: 'execution-key',
          connectionString: undefined,
        },
        vercel: { token: 'execution-token', access: 'private' },
      }
      expect(remove).toHaveBeenCalledExactlyOnceWith(key, config[provider])
    }
  )
})
