import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for Vercel Blob client helpers
 *
 * @vitest-environment node
 */

describe('vercel-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('downloads blob content from the get() stream contract used by @vercel/blob 2.3.3', async () => {
    const getMock = vi.fn().mockResolvedValue({
      statusCode: 200,
      stream: new Response('hello from blob').body,
      headers: new Headers(),
      blob: {
        url: 'https://blob.vercel-storage.com/file.txt',
        downloadUrl: 'https://blob.vercel-storage.com/file.txt?download=1',
        pathname: 'file.txt',
        contentDisposition: 'inline',
        cacheControl: 'public, max-age=3600',
        uploadedAt: new Date('2026-04-19T00:00:00.000Z'),
        etag: 'etag',
        contentType: 'text/plain',
        size: 15,
      },
    })

    vi.doMock('@vercel/blob', () => ({
      del: vi.fn(),
      get: getMock,
      put: vi.fn(),
    }))
    vi.doMock('@/lib/uploads/core/setup', () => ({
      VERCEL_BLOB_CONFIG: {
        token: 'blob-token',
        access: 'private',
      },
    }))
    vi.doMock('@/lib/urls/utils', () => ({
      getBaseUrl: vi.fn().mockReturnValue('https://app.tradinggoose.ai'),
    }))
    vi.doMock('./download-token', () => ({
      createVercelDownloadToken: vi.fn().mockResolvedValue('download-token'),
    }))

    const { downloadFromVercel } = await import('@/lib/uploads/providers/vercel/vercel-client')

    const file = await downloadFromVercel('file.txt', {
      token: 'blob-token',
      access: 'private',
    })

    expect(getMock).toHaveBeenCalledWith('file.txt', {
      access: 'private',
      token: 'blob-token',
    })
    expect(file.toString()).toBe('hello from blob')
  })
})
