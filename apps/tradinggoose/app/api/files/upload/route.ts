import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import '@/lib/uploads/core/setup.server'
import { getSession } from '@/lib/auth'
import {
  buildKnowledgeStorageKey,
  withKnowledgeStorageContext,
} from '@/lib/knowledge/documents/storage'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { resolveUploadContext, validateUploadRequest } from '@/lib/uploads/utils/validation'
import {
  createErrorResponse,
  createOptionsResponse,
  InvalidRequestError,
} from '@/app/api/files/utils'

const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'txt',
  'md',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'csv',
  'xlsx',
  'xls',
  'json',
  'yaml',
  'yml',
])

/**
 * Validates file extension against allowlist
 */
function validateFileExtension(filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension) return false
  return ALLOWED_EXTENSIONS.has(extension)
}

function validateGeneralFileExtension(filename: string) {
  if (validateFileExtension(filename)) return null

  const extension = filename.split('.').pop()?.toLowerCase() || 'unknown'
  return `File type '${extension}' is not allowed. Allowed types: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`
}

function getUploadContext(request: NextRequest): StorageContext {
  const requestUrl = new URL(request.url)
  return resolveUploadContext(requestUrl.searchParams.get('type'))
}

function validateFileForContext(file: File, context: StorageContext): string | null {
  const contentType = file.type || 'application/octet-stream'

  if (context === 'general') {
    return validateGeneralFileExtension(file.name)
  }

  const validationError = validateUploadRequest({
    fileName: file.name,
    contentType,
    fileSize: file.size,
    context,
  })

  return validationError?.message ?? null
}

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesUploadAPI')

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()

    const files = formData.getAll('file') as File[]

    if (!files || files.length === 0) {
      throw new InvalidRequestError('No files provided')
    }

    const workflowId = formData.get('workflowId') as string | null
    const executionId = formData.get('executionId') as string | null
    const workspaceId = formData.get('workspaceId') as string | null
    const knowledgeBaseId = formData.get('knowledgeBaseId') as string | null
    const uploadContext = getUploadContext(request)

    if (uploadContext === 'knowledge-base') {
      if (!workspaceId) {
        throw new InvalidRequestError('workspaceId is required for knowledge-base uploads')
      }
      if (!knowledgeBaseId) {
        throw new InvalidRequestError('knowledgeBaseId is required for knowledge-base uploads')
      }

      const { checkKnowledgeBaseWriteAccess } = await import('@/app/api/knowledge/utils')
      const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, session.user.id)
      if (!accessCheck.hasAccess) {
        return NextResponse.json(
          { error: accessCheck.notFound ? 'Knowledge base not found' : 'Forbidden' },
          { status: accessCheck.notFound ? 404 : 403 }
        )
      }
      if (accessCheck.knowledgeBase.workspaceId !== workspaceId) {
        throw new InvalidRequestError('workspaceId does not match knowledgeBaseId')
      }
    }

    const storageService = await import('@/lib/uploads/core/storage-service')
    const usingCloudStorage = storageService.hasCloudStorage()
    logger.info(
      `Using storage mode: ${usingCloudStorage ? 'Cloud' : 'Local'} for ${uploadContext} file upload`
    )

    if (workflowId && executionId) {
      logger.info(
        `Uploading files for execution-scoped storage: workflow=${workflowId}, execution=${executionId}`
      )
    } else if (workspaceId) {
      logger.info(`Uploading files for workspace-scoped storage: workspace=${workspaceId}`)
    }

    const uploadResults = []

    for (const file of files) {
      const originalName = file.name
      const contentType = file.type || 'application/octet-stream'

      const validationError = validateFileForContext(file, uploadContext)
      if (validationError) {
        throw new InvalidRequestError(validationError)
      }

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      let uploadFileName = originalName
      let preserveUploadKey = false

      if (uploadContext === 'knowledge-base') {
        uploadFileName = buildKnowledgeStorageKey(workspaceId!, knowledgeBaseId!, originalName)
        preserveUploadKey = true
      }

      // Priority 1: Execution-scoped storage (temporary, 5 min expiry)
      if (workflowId && executionId) {
        if (!workspaceId) {
          throw new InvalidRequestError('workspaceId is required for execution-scoped uploads')
        }
        const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
        const userFile = await uploadExecutionFile(
          {
            workspaceId,
            workflowId,
            executionId,
          },
          buffer,
          originalName,
          file.type
        )

        uploadResults.push(userFile)
        continue
      }

      // Priority 2: Workspace-scoped storage (persistent, no expiry)
      if (workspaceId && uploadContext !== 'knowledge-base') {
        try {
          const { uploadWorkspaceFile } = await import('@/lib/uploads/contexts/workspace')
          const userFile = await uploadWorkspaceFile(
            workspaceId,
            session.user.id,
            buffer,
            originalName,
            contentType
          )

          uploadResults.push(userFile)
          continue
        } catch (workspaceError) {
          // Check error type
          const errorMessage =
            workspaceError instanceof Error ? workspaceError.message : 'Upload failed'
          const isDuplicate = errorMessage.includes('already exists')
          const isStorageLimitError =
            errorMessage.includes('Storage limit exceeded') ||
            errorMessage.includes('storage limit')

          logger.warn(`Workspace file upload failed: ${errorMessage}`)

          // Determine appropriate status code
          let statusCode = 500
          if (isDuplicate) statusCode = 409
          else if (isStorageLimitError) statusCode = 413

          return NextResponse.json(
            {
              success: false,
              error: errorMessage,
              isDuplicate,
            },
            { status: statusCode }
          )
        }
      }

      try {
        logger.info(`Uploading file (${uploadContext} context): ${originalName}`)

        const fileInfo = await storageService.uploadFile({
          file: buffer,
          fileName: uploadFileName,
          contentType,
          context: uploadContext,
          ...(preserveUploadKey ? { preserveKey: true, customKey: uploadFileName } : {}),
        })
        const filePath =
          uploadContext === 'knowledge-base'
            ? withKnowledgeStorageContext(fileInfo.path)
            : fileInfo.path

        let downloadUrl: string | undefined
        if (storageService.hasCloudStorage()) {
          try {
            downloadUrl = await storageService.generatePresignedDownloadUrl(
              fileInfo.key,
              uploadContext,
              24 * 60 * 60 // 24 hours
            )
          } catch (error) {
            logger.warn(`Failed to generate presigned URL for ${originalName}:`, error)
          }
        }

        const uploadResult = {
          name: originalName,
          size: buffer.length,
          type: contentType,
          key: fileInfo.key,
          path: filePath,
          url: downloadUrl || filePath,
          uploadedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
          context: uploadContext,
        }

        logger.info(`Successfully uploaded: ${fileInfo.key}`)
        uploadResults.push(uploadResult)
      } catch (error) {
        logger.error(`Error uploading ${originalName}:`, error)
        throw error
      }
    }

    if (uploadResults.length === 1) {
      return NextResponse.json(uploadResults[0])
    }
    return NextResponse.json({ files: uploadResults })
  } catch (error) {
    logger.error('Error in file upload:', error)
    return createErrorResponse(error instanceof Error ? error : new Error('File upload failed'))
  }
}

export async function OPTIONS() {
  return createOptionsResponse()
}
