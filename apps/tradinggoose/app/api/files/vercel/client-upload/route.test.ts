import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFileApiMocks } from '@/app/api/__test-utils__/utils'
import { createVercelUploadToken } from '@/lib/uploads/providers/vercel/upload-token'

/**
 * Tests for Vercel client upload token generation route
 *
 * @vitest-environment node
 */

const createTokenRequest = (
  type: string,
  payload: {
    pathname: string
    clientPayload: string | null
    multipart?: boolean
  }
) =>
  new NextRequest(`http://localhost:3000/api/files/vercel/client-upload?type=${type}`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: {
        pathname: payload.pathname,
        multipart: payload.multipart ?? false,
        clientPayload: payload.clientPayload,
      },
    }),
  })

describe('/api/files/vercel/client-upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createAuthorization = (overrides: Partial<Parameters<typeof createVercelUploadToken>[0]>) =>
    createVercelUploadToken(
      {
        pathname: 'kb/1712345678-report.pdf',
        context: 'knowledge-base',
        contentType: 'application/pdf',
        size: 2048,
        userId: 'user-123',
        ...overrides,
      },
      3600
    )

  it('allows signed upload completion callbacks without a user session', async () => {
    setupFileApiMocks({
      authenticated: false,
      cloudEnabled: true,
      storageProvider: 'vercel',
    })

    const { handleUpload } = await import('@vercel/blob/client')
    vi.mocked(handleUpload).mockImplementation(async ({ body, onUploadCompleted }) => {
      expect(body.type).toBe('blob.upload-completed')

      await onUploadCompleted?.({
        blob: {
          url: 'https://store.public.blob.vercel-storage.com/kb/1712345678-report.pdf',
          downloadUrl:
            'https://store.public.blob.vercel-storage.com/kb/1712345678-report.pdf?download=1',
          pathname: 'kb/1712345678-report.pdf',
          contentType: 'application/pdf',
          contentDisposition: 'attachment; filename="report.pdf"',
          etag: 'etag-123',
        },
        tokenPayload: JSON.stringify({
          context: 'knowledge-base',
          userId: 'user-123',
        }),
      })

      return {
        type: 'blob.upload-completed',
        response: 'ok',
      }
    })

    const { POST } = await import('@/app/api/files/vercel/client-upload/route')
    const request = new NextRequest(
      'http://localhost:3000/api/files/vercel/client-upload?type=knowledge-base',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vercel-signature': 'signed-callback',
        },
        body: JSON.stringify({
          type: 'blob.upload-completed',
          payload: {
            pathname: 'kb/1712345678-report.pdf',
          },
        }),
      }
    )

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      type: 'blob.upload-completed',
      response: 'ok',
    })
  })

  it('still requires an authenticated session to generate a client upload token', async () => {
    setupFileApiMocks({
      authenticated: false,
      cloudEnabled: true,
      storageProvider: 'vercel',
    })

    const { handleUpload } = await import('@vercel/blob/client')
    vi.mocked(handleUpload).mockImplementation(async ({ body, onBeforeGenerateToken }) => {
      if (body.type !== 'blob.generate-client-token') {
        throw new Error('Expected client token generation request')
      }

      await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload, false)

      return {
        type: 'blob.generate-client-token',
        clientToken: 'client-token',
      }
    })

    const { POST } = await import('@/app/api/files/vercel/client-upload/route')
    const request = createTokenRequest('knowledge-base', {
      pathname: 'kb/1712345678-report.pdf',
      clientPayload: JSON.stringify({
        clientUploadAuthorization: await createAuthorization({}),
        pathname: 'kb/1712345678-report.pdf',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        fileSize: 2048,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('binds generated Vercel upload tokens to the declared content type and file size', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 'vercel',
    })

    const { handleUpload } = await import('@vercel/blob/client')
    const handleUploadMock = vi.mocked(handleUpload)
    let capturedTokenOptions: Record<string, unknown> | undefined

    handleUploadMock.mockImplementation(async ({ body, onBeforeGenerateToken }) => {
      if (body.type !== 'blob.generate-client-token') {
        throw new Error('Expected client token generation request')
      }

      capturedTokenOptions = await onBeforeGenerateToken(
        body.payload.pathname,
        body.payload.clientPayload,
        body.payload.multipart
      )

      return {
        type: 'blob.generate-client-token',
        clientToken: 'client-token',
      }
    })

    const { POST } = await import('@/app/api/files/vercel/client-upload/route')
    const authorization = await createAuthorization({})
    const request = createTokenRequest('knowledge-base', {
      pathname: 'kb/1712345678-report.pdf',
      clientPayload: JSON.stringify({
        clientUploadAuthorization: authorization,
        pathname: 'kb/1712345678-report.pdf',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        fileSize: 2048,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      type: 'blob.generate-client-token',
      clientToken: 'client-token',
    })
    expect(capturedTokenOptions).toMatchObject({
      allowedContentTypes: ['application/pdf'],
      maximumSizeInBytes: 2048,
      addRandomSuffix: false,
      allowOverwrite: false,
    })
  })

  it('rejects oversized uploads before generating a client token', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 'vercel',
    })

    const { handleUpload } = await import('@vercel/blob/client')
    vi.mocked(handleUpload).mockImplementation(async ({ body, onBeforeGenerateToken }) => {
      if (body.type !== 'blob.generate-client-token') {
        throw new Error('Expected client token generation request')
      }

      await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload, false)

      return {
        type: 'blob.generate-client-token',
        clientToken: 'client-token',
      }
    })

    const { POST } = await import('@/app/api/files/vercel/client-upload/route')
    const authorization = await createAuthorization({ size: 101 * 1024 * 1024 })
    const request = createTokenRequest('knowledge-base', {
      pathname: 'kb/1712345678-report.pdf',
      clientPayload: JSON.stringify({
        clientUploadAuthorization: authorization,
        pathname: 'kb/1712345678-report.pdf',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        fileSize: 101 * 1024 * 1024,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('exceeds maximum allowed size')
  })

  it('rejects non-image copilot uploads before generating a client token', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 'vercel',
    })

    const { handleUpload } = await import('@vercel/blob/client')
    vi.mocked(handleUpload).mockImplementation(async ({ body, onBeforeGenerateToken }) => {
      if (body.type !== 'blob.generate-client-token') {
        throw new Error('Expected client token generation request')
      }

      await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload, false)

      return {
        type: 'blob.generate-client-token',
        clientToken: 'client-token',
      }
    })

    const { POST } = await import('@/app/api/files/vercel/client-upload/route')
    const request = createTokenRequest('copilot', {
      pathname: 'copilot/1712345678-notes.txt',
      clientPayload: JSON.stringify({
        clientUploadAuthorization: await createVercelUploadToken(
          {
            pathname: 'copilot/1712345678-notes.txt',
            context: 'copilot',
            contentType: 'text/plain',
            size: 2048,
            userId: 'user-123',
          },
          3600
        ),
        pathname: 'copilot/1712345678-notes.txt',
        fileName: 'notes.txt',
        contentType: 'text/plain',
        fileSize: 2048,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe(
      'Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed for copilot uploads'
    )
  })

  it('rejects non-image profile picture uploads before generating a client token', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 'vercel',
    })

    const { handleUpload } = await import('@vercel/blob/client')
    vi.mocked(handleUpload).mockImplementation(async ({ body, onBeforeGenerateToken }) => {
      if (body.type !== 'blob.generate-client-token') {
        throw new Error('Expected client token generation request')
      }

      await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload, false)

      return {
        type: 'blob.generate-client-token',
        clientToken: 'client-token',
      }
    })

    const { POST } = await import('@/app/api/files/vercel/client-upload/route')
    const request = createTokenRequest('profile-pictures', {
      pathname: '1712345678-avatar.txt',
      clientPayload: JSON.stringify({
        clientUploadAuthorization: await createVercelUploadToken(
          {
            pathname: '1712345678-avatar.txt',
            context: 'profile-pictures',
            contentType: 'text/plain',
            size: 1024,
            userId: 'user-123',
          },
          3600
        ),
        pathname: '1712345678-avatar.txt',
        fileName: 'avatar.txt',
        contentType: 'text/plain',
        fileSize: 1024,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe(
      'Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed for profile picture uploads'
    )
  })

  it('rejects uploads whose pathname does not match the server authorization', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 'vercel',
    })

    const { handleUpload } = await import('@vercel/blob/client')
    vi.mocked(handleUpload).mockImplementation(async ({ body, onBeforeGenerateToken }) => {
      if (body.type !== 'blob.generate-client-token') {
        throw new Error('Expected client token generation request')
      }

      await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload, false)

      return {
        type: 'blob.generate-client-token',
        clientToken: 'client-token',
      }
    })

    const { POST } = await import('@/app/api/files/vercel/client-upload/route')
    const request = createTokenRequest('knowledge-base', {
      pathname: 'kb/1712345678-other.pdf',
      clientPayload: JSON.stringify({
        clientUploadAuthorization: await createAuthorization({}),
        pathname: 'kb/1712345678-other.pdf',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        fileSize: 2048,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Upload pathname is not authorized')
  })
})
