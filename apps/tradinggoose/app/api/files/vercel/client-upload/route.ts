import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getStorageConfig } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { getStorageProvider } from '@/lib/uploads/core/setup'
import { createLogger } from '@/lib/logs/console/logger'
import { verifyVercelUploadToken } from '@/lib/uploads/providers/vercel/upload-token'
import { resolveUploadContext, validateUploadRequest } from '@/lib/uploads/utils/validation'

const logger = createLogger('VercelClientUploadAPI')

interface ClientUploadPayload {
  clientUploadAuthorization?: string
  contentType?: string
  fileName?: string
  fileSize?: number
  pathname?: string
}

class ClientUploadValidationError extends Error {
  constructor(
    message: string,
    public statusCode = 400
  ) {
    super(message)
    this.name = 'ClientUploadValidationError'
  }
}

function parseClientUploadPayload(clientPayload: string | null): ClientUploadPayload {
  if (!clientPayload) {
    throw new ClientUploadValidationError('clientPayload is required for Vercel client uploads')
  }

  try {
    return JSON.parse(clientPayload) as ClientUploadPayload
  } catch {
    throw new ClientUploadValidationError('clientPayload must be valid JSON')
  }
}

export async function POST(request: Request) {
  try {
    if (getStorageProvider() !== 'vercel') {
      return NextResponse.json({ error: 'Vercel Blob storage is not enabled' }, { status: 400 })
    }

    const url = new URL(request.url)
    const context: StorageContext = resolveUploadContext(url.searchParams.get('type'))
    const body = (await request.json()) as HandleUploadBody
    const config = getStorageConfig(context)

    if (!config.token || !config.access) {
      return NextResponse.json(
        { error: 'Vercel Blob configuration missing token or access' },
        { status: 500 }
      )
    }

    const response = await handleUpload({
      body,
      request,
      token: config.token,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        const session = await getSession()
        if (!session?.user?.id) {
          throw new ClientUploadValidationError('Unauthorized', 401)
        }

        if (!pathname || pathname.startsWith('/') || pathname.includes('..')) {
          throw new ClientUploadValidationError('Invalid upload pathname')
        }

        const parsedPayload = parseClientUploadPayload(clientPayload)
        const authorizedUpload = parsedPayload.clientUploadAuthorization
          ? await verifyVercelUploadToken(parsedPayload.clientUploadAuthorization)
          : null

        if (!authorizedUpload) {
          throw new ClientUploadValidationError('Valid client upload authorization is required')
        }

        if (authorizedUpload.userId !== session.user.id) {
          throw new ClientUploadValidationError('Upload authorization does not match the user')
        }

        if (authorizedUpload.context !== context) {
          throw new ClientUploadValidationError('Upload authorization does not match the context')
        }

        if (authorizedUpload.pathname !== pathname) {
          throw new ClientUploadValidationError('Upload pathname is not authorized')
        }

        if (parsedPayload.pathname && parsedPayload.pathname !== authorizedUpload.pathname) {
          throw new ClientUploadValidationError('Upload pathname does not match authorization')
        }

        if (parsedPayload.contentType !== authorizedUpload.contentType) {
          throw new ClientUploadValidationError('Upload content type does not match authorization')
        }

        if (parsedPayload.fileSize !== authorizedUpload.size) {
          throw new ClientUploadValidationError('Upload size does not match authorization')
        }

        const validationError = validateUploadRequest({
          fileName: authorizedUpload.pathname,
          contentType: authorizedUpload.contentType,
          fileSize: authorizedUpload.size,
          context,
        })

        if (validationError) {
          throw new ClientUploadValidationError(validationError.message)
        }

        return {
          addRandomSuffix: false,
          allowOverwrite: false,
          allowedContentTypes: [authorizedUpload.contentType],
          maximumSizeInBytes: authorizedUpload.size,
          validUntil: authorizedUpload.exp * 1000,
          tokenPayload: JSON.stringify({
            context,
            contentType: authorizedUpload.contentType,
            fileName: parsedPayload.fileName || authorizedUpload.pathname,
            fileSize: authorizedUpload.size,
            multipart,
            pathname: authorizedUpload.pathname,
            userId: session.user.id,
          }),
        }
      },
      onUploadCompleted: async ({ blob }) => {
        logger.info('Completed Vercel client upload', {
          context,
          pathname: blob.pathname,
          size: 'size' in blob ? blob.size : undefined,
        })
      },
    })

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Vercel client upload error:', error)
    if (error instanceof ClientUploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to handle upload' },
      { status: 500 }
    )
  }
}
