import { NextRequest } from 'next/server'
/**
 * Tests for file serve API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupApiTestMocks } from '@/app/api/__test-utils__/utils'

const checkHybridAuthMock = vi.fn()

function createFileUtilsMock(contentType = 'text/plain', localFilePath = '/test/uploads/test-file.txt') {
  return {
    FileNotFoundError: class FileNotFoundError extends Error {
      constructor(message: string) {
        super(message)
        this.name = 'FileNotFoundError'
      }
    },
    createFileResponse: vi.fn().mockImplementation((file) => {
      return new Response(file.buffer, {
        status: 200,
        headers: {
          'Content-Type': file.contentType,
          'Content-Disposition': `inline; filename="${file.filename}"`,
        },
      })
    }),
    createErrorResponse: vi.fn().mockImplementation((error) => {
      return new Response(JSON.stringify({ error: error.name, message: error.message }), {
        status: error.name === 'FileNotFoundError' ? 404 : 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
    getContentType: vi.fn().mockReturnValue(contentType),
    isS3Path: vi.fn().mockReturnValue(false),
    isAzurePath: vi.fn().mockReturnValue(false),
    extractS3Key: vi.fn().mockImplementation((path) => path.split('/').pop()),
    extractAzureKey: vi.fn().mockImplementation((path) => path.split('/').pop()),
    extractFilename: vi.fn().mockImplementation((path) => path.split('/').pop()),
    findLocalFile: vi.fn().mockReturnValue(localFilePath),
  }
}

describe('File Serve API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    checkHybridAuthMock.mockReset()
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'test-user-id',
    })

    vi.doMock('@/lib/env', () => ({
      env: {
        INTERNAL_API_SECRET: '12345678901234567890123456789012',
      },
      getEnv: vi.fn((key: string) => {
        if (key === 'NEXT_PUBLIC_APP_URL') return 'https://app.tradinggoose.ai'
        if (key === 'NEXT_PUBLIC_IS_PREVIEW_DEVELOPMENT') return 'false'
        return undefined
      }),
    }))

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: checkHybridAuthMock,
    }))

    setupApiTestMocks({
      withFileSystem: true,
      withUploadUtils: true,
    })

    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
    }))

    vi.doMock('@/app/api/files/utils', () => createFileUtilsMock())

    vi.doMock('@/lib/uploads/setup.server', () => ({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should serve local file successfully', async () => {
    const req = new NextRequest('http://localhost:3000/api/files/serve/test-file.txt')
    const params = { path: ['test-file.txt'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain')
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="test-file.txt"')

    const fs = await import('fs/promises')
    expect(fs.readFile).toHaveBeenCalledWith('/test/uploads/test-file.txt')
  })

  it('should handle nested paths correctly', async () => {
    vi.doMock('@/app/api/files/utils', () =>
      createFileUtilsMock('text/plain', '/test/uploads/nested/path/file.txt')
    )

    const req = new NextRequest('http://localhost:3000/api/files/serve/nested/path/file.txt')
    const params = { path: ['nested', 'path', 'file.txt'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)

    const fs = await import('fs/promises')
    expect(fs.readFile).toHaveBeenCalledWith('/test/uploads/nested/path/file.txt')
  })

  it('should serve cloud file by downloading and proxying', async () => {
    const downloadFileMock = vi.fn().mockResolvedValue(Buffer.from('test cloud file content'))

    vi.doMock('@/lib/uploads', () => ({
      StorageService: {
        downloadFile: downloadFileMock,
        generatePresignedDownloadUrl: vi
          .fn()
          .mockResolvedValue('https://example-s3.com/presigned-url'),
        hasCloudStorage: vi.fn().mockReturnValue(true),
      },
      isUsingCloudStorage: vi.fn().mockReturnValue(true),
    }))

    vi.doMock('@/lib/uploads/core/storage-service', () => ({
      downloadFile: downloadFileMock,
      hasCloudStorage: vi.fn().mockReturnValue(true),
    }))

    vi.doMock('@/lib/uploads/core/setup', () => ({
      UPLOAD_DIR: '/test/uploads',
      USE_S3_STORAGE: true,
      USE_AZURE_STORAGE: false,
      USE_VERCEL_STORAGE: false,
    }))

    vi.doMock('@/app/api/files/utils', () => createFileUtilsMock('image/png'))

    const req = new NextRequest('http://localhost:3000/api/files/serve/s3/1234567890-image.png')
    const params = { path: ['s3', '1234567890-image.png'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')

    expect(downloadFileMock).toHaveBeenCalledWith({
      key: '1234567890-image.png',
      context: 'general',
    })
  })

  it('should return 404 when file not found', async () => {
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(false),
    }))

    vi.doMock('fs/promises', () => ({
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
    }))

    vi.doMock('@/app/api/files/utils', () => ({
      FileNotFoundError: class FileNotFoundError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'FileNotFoundError'
        }
      },
      createFileResponse: vi.fn(),
      createErrorResponse: vi.fn().mockImplementation((error) => {
        return new Response(JSON.stringify({ error: error.name, message: error.message }), {
          status: error.name === 'FileNotFoundError' ? 404 : 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      getContentType: vi.fn().mockReturnValue('text/plain'),
      isS3Path: vi.fn().mockReturnValue(false),
      isAzurePath: vi.fn().mockReturnValue(false),
      extractS3Key: vi.fn(),
      extractAzureKey: vi.fn(),
      extractFilename: vi.fn(),
      findLocalFile: vi.fn().mockReturnValue(null),
    }))

    const req = new NextRequest('http://localhost:3000/api/files/serve/nonexistent.txt')
    const params = { path: ['nonexistent.txt'] }
    const { GET } = await import('@/app/api/files/serve/[...path]/route')

    const response = await GET(req, { params: Promise.resolve(params) })

    expect(response.status).toBe(404)

    const responseData = await response.json()
    expect(responseData).toEqual({
      error: 'FileNotFoundError',
      message: expect.stringContaining('File not found'),
    })
  })

  describe('content type detection', () => {
    const contentTypeTests = [
      { ext: 'pdf', contentType: 'application/pdf' },
      { ext: 'json', contentType: 'application/json' },
      { ext: 'jpg', contentType: 'image/jpeg' },
      { ext: 'txt', contentType: 'text/plain' },
      { ext: 'unknown', contentType: 'application/octet-stream' },
    ]

    for (const test of contentTypeTests) {
      it(`should serve ${test.ext} file with correct content type`, async () => {
        vi.doMock('@/app/api/files/utils', () => ({
          getContentType: () => test.contentType,
          findLocalFile: () => `/test/uploads/file.${test.ext}`,
          createFileResponse: (obj: { buffer: Buffer; contentType: string; filename: string }) =>
            new Response(obj.buffer as any, {
              status: 200,
              headers: {
                'Content-Type': obj.contentType,
                'Content-Disposition': `inline; filename="${obj.filename}"`,
                'Cache-Control': 'public, max-age=31536000',
              },
            }),
          createErrorResponse: () => new Response(null, { status: 404 }),
        }))

        const req = new NextRequest(`http://localhost:3000/api/files/serve/file.${test.ext}`)
        const params = { path: [`file.${test.ext}`] }
        const { GET } = await import('@/app/api/files/serve/[...path]/route')

        const response = await GET(req, { params: Promise.resolve(params) })

        expect(response.headers.get('Content-Type')).toBe(test.contentType)
      })
    }
  })

  describe('signed Vercel downloads', () => {
    it('should generate an absolute signed Vercel download URL', async () => {
      vi.doMock('@/lib/urls/utils', () => ({
        getBaseUrl: vi.fn().mockReturnValue('https://app.tradinggoose.ai'),
      }))

      const { getDownloadUrlWithConfig } = await import(
        '@/lib/uploads/providers/vercel/vercel-client'
      )
      const { verifyVercelDownloadToken } = await import(
        '@/lib/uploads/providers/vercel/download-token'
      )

      const downloadUrl = await getDownloadUrlWithConfig(
        'kb/private-report.pdf',
        { token: 'blob-token', access: 'private' },
        300,
        'knowledge-base'
      )

      const url = new URL(downloadUrl)
      expect(url.origin).toBe('https://app.tradinggoose.ai')
      expect(url.pathname).toBe('/api/files/serve/vercel/kb%2Fprivate-report.pdf')

      const token = url.searchParams.get('downloadToken')
      expect(token).toBeTruthy()
      await expect(verifyVercelDownloadToken(token!)).resolves.toEqual({
        key: 'kb/private-report.pdf',
        context: 'knowledge-base',
      })
    })

    it('should serve a signed Vercel download without hybrid auth', async () => {
      const downloadCopilotFileMock = vi.fn().mockResolvedValue(Buffer.from('signed file'))

      vi.doMock('@/lib/uploads', () => ({
        CopilotFiles: {
          downloadCopilotFile: downloadCopilotFileMock,
        },
        isUsingCloudStorage: vi.fn().mockReturnValue(false),
      }))

      vi.doMock('@/lib/uploads/core/storage-service', () => ({
        downloadFile: vi.fn(),
      }))

      const { createVercelDownloadToken } = await import(
        '@/lib/uploads/providers/vercel/download-token'
      )
      const token = await createVercelDownloadToken(
        { key: 'copilot-image.png', context: 'copilot' },
        300
      )

      const req = new NextRequest(
        `http://localhost:3000/api/files/serve/vercel/copilot-image.png?downloadToken=${encodeURIComponent(token)}&context=general`
      )
      const params = { path: ['vercel', 'copilot-image.png'] }
      const { GET } = await import('@/app/api/files/serve/[...path]/route')

      const response = await GET(req, { params: Promise.resolve(params) })

      expect(response.status).toBe(200)
      expect(checkHybridAuthMock).not.toHaveBeenCalled()
      expect(downloadCopilotFileMock).toHaveBeenCalledWith('copilot-image.png')
    })

    it('should reject expired signed Vercel downloads without fallback access', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-19T00:00:00Z'))

      const downloadFileMock = vi.fn()
      checkHybridAuthMock.mockResolvedValue({
        success: false,
        error: 'Unauthorized',
      })

      vi.doMock('@/lib/uploads', () => ({
        CopilotFiles: {
          downloadCopilotFile: vi.fn(),
        },
        isUsingCloudStorage: vi.fn().mockReturnValue(false),
      }))

      vi.doMock('@/lib/uploads/core/storage-service', () => ({
        downloadFile: downloadFileMock,
      }))

      const { createVercelDownloadToken, verifyVercelDownloadToken } = await import(
        '@/lib/uploads/providers/vercel/download-token'
      )
      const token = await createVercelDownloadToken({ key: 'private.pdf', context: 'general' }, 1)

      vi.setSystemTime(new Date('2026-04-19T00:00:02Z'))
      await expect(verifyVercelDownloadToken(token)).resolves.toBeNull()

      const req = new NextRequest(
        `http://localhost:3000/api/files/serve/vercel/private.pdf?downloadToken=${encodeURIComponent(token)}`
      )
      const params = { path: ['vercel', 'private.pdf'] }
      const { GET } = await import('@/app/api/files/serve/[...path]/route')

      const response = await GET(req, { params: Promise.resolve(params) })

      expect(response.status).toBe(401)
      expect(checkHybridAuthMock).toHaveBeenCalledWith(req, { requireWorkflowId: false })
      expect(downloadFileMock).not.toHaveBeenCalled()
    })
  })
})
