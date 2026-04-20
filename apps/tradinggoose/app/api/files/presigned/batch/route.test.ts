import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFileApiMocks } from '@/app/api/__test-utils__/utils'

/**
 * Tests for batch file presigned API route
 *
 * @vitest-environment node
 */

describe('/api/files/presigned/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns Vercel upload authorization for each batch item', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 'vercel',
    })

    vi.doMock('@/lib/uploads/core/storage-service', () => ({
      hasCloudStorage: vi.fn().mockReturnValue(true),
      generateBatchPresignedUploadUrls: vi.fn().mockResolvedValue([
        {
          url: '',
          key: 'kb/1712345678-report.pdf',
        },
        {
          url: '',
          key: 'kb/1712345678-notes.md',
        },
      ]),
    }))

    const { POST } = await import('@/app/api/files/presigned/batch/route')

    const request = new NextRequest(
      'http://localhost:3000/api/files/presigned/batch?type=knowledge-base',
      {
        method: 'POST',
        body: JSON.stringify({
          files: [
            {
              fileName: 'report.pdf',
              contentType: 'application/pdf',
              fileSize: 1024,
            },
            {
              fileName: 'notes.md',
              contentType: 'text/markdown',
              fileSize: 2048,
            },
          ],
        }),
      }
    )

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.requiresClientUpload).toBe(true)
    expect(data.directUploadSupported).toBe(false)
    expect(data.files).toHaveLength(2)
    expect(data.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storageProvider: 'vercel',
          blobAccess: 'private',
          clientUploadAuthorization: expect.any(String),
          requiresClientUpload: true,
          presignedUrl: '',
          directUploadSupported: false,
        }),
      ])
    )
  })
})
