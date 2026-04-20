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
})
