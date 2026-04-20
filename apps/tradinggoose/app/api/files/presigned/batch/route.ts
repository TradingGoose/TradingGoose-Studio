import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { getStorageConfig } from '@/lib/uploads/core/config-resolver'
import { getStorageProvider } from '@/lib/uploads/core/setup'
import {
  generateBatchPresignedUploadUrls,
  hasCloudStorage,
} from '@/lib/uploads/core/storage-service'
import { createVercelUploadToken } from '@/lib/uploads/providers/vercel/upload-token'
import { resolveUploadContext, validateUploadRequest } from '@/lib/uploads/utils/validation'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('BatchPresignedUploadAPI')

interface BatchFileRequest {
  fileName: string
  contentType: string
  fileSize: number
}

interface BatchPresignedUrlRequest {
  files: BatchFileRequest[]
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let data: BatchPresignedUrlRequest
    try {
      data = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    const { files } = data

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        { error: 'files array is required and cannot be empty' },
        { status: 400 }
      )
    }

    if (files.length > 100) {
      return NextResponse.json(
        { error: 'Cannot process more than 100 files at once' },
        { status: 400 }
      )
    }

    const uploadType: StorageContext = resolveUploadContext(
      request.nextUrl.searchParams.get('type')
    )
    for (const file of files) {
      const validationError = validateUploadRequest({
        fileName: file.fileName,
        contentType: file.contentType,
        fileSize: file.fileSize,
        context: uploadType,
      })

      if (validationError) {
        return NextResponse.json(
          {
            error: validationError.message,
            code: validationError.code,
            supportedTypes: validationError.supportedTypes,
          },
          { status: 400 }
        )
      }
    }

    const sessionUserId = session.user.id

    if (uploadType === 'copilot' && !sessionUserId?.trim()) {
      return NextResponse.json(
        { error: 'Authenticated user session is required for copilot uploads' },
        { status: 400 }
      )
    }

    if (!hasCloudStorage()) {
      logger.info(
        `Local storage detected - batch presigned URLs not available, client will use API fallback`
      )
      return NextResponse.json({
        files: files.map((file) => ({
          fileName: file.fileName,
          presignedUrl: '', // Empty URL signals fallback to API upload
          fileInfo: {
            path: '',
            key: '',
            name: file.fileName,
            size: file.fileSize,
            type: file.contentType,
          },
          storageProvider: 'local',
          directUploadSupported: false,
        })),
        directUploadSupported: false,
      })
    }

    logger.info(`Generating batch ${uploadType} presigned URLs for ${files.length} files`)

    const startTime = Date.now()

    const presignedUrls = await generateBatchPresignedUploadUrls(
      files.map((file) => ({
        fileName: file.fileName,
        contentType: file.contentType,
        fileSize: file.fileSize,
      })),
      uploadType,
      sessionUserId,
      3600 // 1 hour
    )

    const duration = Date.now() - startTime
    logger.info(
      `Generated ${files.length} presigned URLs in ${duration}ms (avg ${Math.round(duration / files.length)}ms per file)`
    )

    const storageProvider = getStorageProvider()
    const storageConfig = getStorageConfig(uploadType)

    return NextResponse.json({
      files: await Promise.all(
        presignedUrls.map(async (urlResponse, index) => {
          const finalPath = `/api/files/serve/${storageProvider}/${encodeURIComponent(urlResponse.key)}?context=${uploadType}`
          const clientUploadAuthorization =
            storageProvider === 'vercel'
              ? await createVercelUploadToken(
                  {
                    pathname: urlResponse.key,
                    context: uploadType,
                    contentType: files[index].contentType,
                    size: files[index].fileSize,
                    userId: sessionUserId,
                  },
                  3600
                )
              : undefined

          return {
            fileName: files[index].fileName,
            presignedUrl: urlResponse.url,
            fileInfo: {
              path: finalPath,
              key: urlResponse.key,
              name: files[index].fileName,
              size: files[index].fileSize,
              type: files[index].contentType,
            },
            storageProvider,
            blobAccess: storageProvider === 'vercel' ? storageConfig.access : undefined,
            clientUploadAuthorization,
            context: uploadType,
            uploadHeaders: urlResponse.uploadHeaders,
            directUploadSupported: true,
          }
        })
      ),
      directUploadSupported: true,
    })
  } catch (error) {
    logger.error('Error generating batch presigned URLs:', error)
    return createErrorResponse(
      error instanceof Error ? error : new Error('Failed to generate batch presigned URLs')
    )
  }
}

export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    }
  )
}
