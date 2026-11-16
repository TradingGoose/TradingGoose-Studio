import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for storage service Vercel behavior
 *
 * @vitest-environment node
 */

describe('storage-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doUnmock('@/lib/uploads/core/config-resolver')
  })

  it('returns a context-aware serve path for Vercel uploads', async () => {
    const uploadToVercelMock = vi.fn().mockResolvedValue({
      path: '/api/files/serve/vercel/workspace%2Freport.txt',
      key: 'workspace/report.txt',
      name: 'workspace/report.txt',
      size: 4,
      type: 'text/plain',
    })

    vi.doMock('@/lib/uploads/core/setup', () => ({
      USE_AZURE_STORAGE: false,
      USE_S3_STORAGE: false,
      USE_VERCEL_STORAGE: true,
    }))
    vi.doMock('@/lib/uploads/core/config-resolver', () => ({
      getStorageConfig: vi.fn().mockReturnValue({
        token: 'blob-token',
        access: 'private',
      }),
    }))
    vi.doMock('@/lib/uploads/providers/vercel/vercel-client', () => ({
      uploadToVercel: uploadToVercelMock,
    }))

    const { uploadFile } = await import('@/lib/uploads/core/storage-service')

    const result = await uploadFile({
      file: Buffer.from('test'),
      fileName: 'workspace/report.txt',
      contentType: 'text/plain',
      context: 'workspace',
      preserveKey: true,
      customKey: 'workspace/report.txt',
    })

    expect(uploadToVercelMock).toHaveBeenCalled()
    expect(result.path).toBe('/api/files/serve/vercel/workspace%2Freport.txt?context=workspace')
  })

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
