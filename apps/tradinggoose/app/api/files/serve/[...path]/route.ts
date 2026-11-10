import { readFile } from 'fs/promises'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { isUsingCloudStorage } from '@/lib/uploads'
import { assertPublicStorageInput } from '@/lib/uploads/archive-boundary'
import {
  CopilotSourceError,
  isCopilotSourceReference,
} from '@/lib/uploads/contexts/copilot/source-proof'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { verifyVercelDownloadToken } from '@/lib/uploads/providers/vercel/download-token'
import {
  assertStorageReadAccess,
  withAuthorizedStorageRead,
} from '@/lib/uploads/source-read-boundary'
import {
  createErrorResponse,
  createFileResponse,
  FileNotFoundError,
  findLocalFile,
  getContentType,
} from '@/app/api/files/utils'

const logger = createLogger('FilesServeAPI')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params

    if (!path || path.length === 0) {
      throw new FileNotFoundError('No file path provided')
    }

    logger.info('File serve request:', { path })

    assertPublicStorageInput(
      path.join('/'),
      request.nextUrl.searchParams.get('context') ?? undefined
    )
    const fullPath = path.join('/')
    const isS3Path = path[0] === 's3'
    const isAzurePath = path[0] === 'azure'
    const isVercelPath = path[0] === 'vercel'
    const isCloudPath = isS3Path || isAzurePath || isVercelPath
    const cloudKey = isCloudPath ? path.slice(1).join('/') : fullPath

    if (
      request.nextUrl.searchParams.get('context') === 'copilot' ||
      isCopilotSourceReference(cloudKey)
    ) {
      const { processCopilotAttachments } = await import('@/lib/uploads/contexts/copilot')
      const session = await getSession()
      if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const [file] = await processCopilotAttachments(
        [{ key: cloudKey, sourceProof: request.nextUrl.searchParams.get('sourceProof') || '' }],
        {
          actorUserId: session.user.id,
          workspaceId: request.nextUrl.searchParams.get('workspaceId'),
        },
        'copilot-file-serve',
        request.signal
      )
      if (!file) throw new CopilotSourceError('Attachment is unavailable', 404)
      return privateFileResponse({
        buffer: file.buffer,
        contentType: file.attachment.media_type,
        filename: file.attachment.filename,
      })
    }

    if (request.nextUrl.searchParams.get('context') === 'workspace') {
      const workspaceId = request.nextUrl.searchParams.get('workspaceId')
      const fileId = request.nextUrl.searchParams.get('fileId')
      if (workspaceId && fileId) {
        const session = await getSession()
        if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        const { checkWorkspaceAccess } = await import('@/lib/permissions/utils')
        const { getWorkspaceFile } = await import('@/lib/uploads/contexts/workspace')
        if (!(await checkWorkspaceAccess(workspaceId, session.user.id)).hasAccess)
          return NextResponse.json({ error: 'File access denied' }, { status: 403 })
        const file = await getWorkspaceFile(workspaceId, fileId)
        if (!file || file.key !== decodeURIComponent(cloudKey))
          return NextResponse.json({ error: 'File is unavailable' }, { status: 404 })
        const buffer = await withAuthorizedStorageRead(file.key, 'workspace', () =>
          downloadFile({ key: file.key, context: 'workspace' })
        )
        return privateFileResponse({ buffer, contentType: file.type, filename: file.name })
      }
    }

    const signedVercelAccess = isVercelPath
      ? await resolveSignedVercelAccess(request, cloudKey)
      : { authorized: false as const }
    if (signedVercelAccess.authorized && signedVercelAccess.context === 'copilot')
      return NextResponse.json(
        { error: 'Copilot images require authenticated source authorization' },
        { status: 403 }
      )

    let userId: string | undefined

    if (!signedVercelAccess.authorized) {
      const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

      if (!authResult.success) {
        logger.warn('Unauthorized file access attempt', { path, error: authResult.error })
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      userId = authResult.userId
    }

    const contextParam = signedVercelAccess.authorized
      ? signedVercelAccess.context
      : request.nextUrl.searchParams.get('context')

    if (isUsingCloudStorage() || isCloudPath) {
      return await handleCloudProxy(cloudKey, contextParam, userId)
    }

    assertStorageReadAccess(fullPath)
    return await handleLocalFile(fullPath, userId)
  } catch (error) {
    logger.error('Error serving file:', error)
    if (error instanceof CopilotSourceError)
      return NextResponse.json({ error: error.message }, { status: error.status })

    if (error instanceof FileNotFoundError) {
      return createErrorResponse(error)
    }

    return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
  }
}

async function resolveSignedVercelAccess(
  request: NextRequest,
  cloudKey: string
): Promise<{ authorized: true; context?: StorageContext } | { authorized: false }> {
  const downloadToken = request.nextUrl.searchParams.get('downloadToken')
  if (!downloadToken) {
    return { authorized: false }
  }

  const tokenClaims = await verifyVercelDownloadToken(downloadToken)
  if (!tokenClaims || tokenClaims.key !== cloudKey) {
    logger.warn('Invalid signed Vercel download token', { key: cloudKey })
    return { authorized: false }
  }

  return {
    authorized: true,
    context: tokenClaims.context,
  }
}

async function handleLocalFile(filename: string, userId?: string): Promise<NextResponse> {
  try {
    const filePath = findLocalFile(filename)

    if (!filePath) {
      throw new FileNotFoundError(`File not found: ${filename}`)
    }

    const fileBuffer = await readFile(filePath)
    const contentType = getContentType(filename)

    logger.info('Local file served', { userId, filename, size: fileBuffer.length })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename,
    })
  } catch (error) {
    logger.error('Error reading local file:', error)
    throw error
  }
}

/**
 * Infer storage context from file key pattern
 */
function inferContextFromKey(key: string): StorageContext {
  // KB files always start with 'kb/' prefix
  if (key.startsWith('kb/')) {
    return 'knowledge-base'
  }

  // Workspace files: UUID-like ID followed by timestamp pattern
  // Pattern: {uuid}/{timestamp}-{random}-{filename}
  if (key.match(/^[a-f0-9-]{36}\/\d+-[a-z0-9]+-/)) {
    return 'workspace'
  }

  // Execution files: three UUID segments (workspace/workflow/execution)
  // Pattern: {uuid}/{uuid}/{uuid}/{filename}
  const segments = key.split('/')
  if (segments.length >= 4 && segments[0].match(/^[a-f0-9-]{36}$/)) {
    return 'execution'
  }

  // Copilot files: timestamp-random-filename (no path segments)
  // Pattern: {timestamp}-{random}-{filename}
  // NOTE: This is ambiguous with other contexts - prefer explicit context parameter
  if (key.match(/^\d+-[a-z0-9]+-/)) {
    // Could be copilot, general, or chat - default to general
    return 'general'
  }

  return 'general'
}

async function handleCloudProxy(
  cloudKey: string,
  contextParam?: string | null,
  userId?: string
): Promise<NextResponse> {
  try {
    let context: StorageContext

    if (contextParam) {
      context = contextParam as StorageContext
      logger.info(`Using explicit context: ${context} for key: ${cloudKey}`)
    } else {
      context = inferContextFromKey(cloudKey)
      logger.info(`Inferred context: ${context} from key pattern: ${cloudKey}`)
    }

    const fileBuffer = await downloadFile({
      key: cloudKey,
      context,
    })

    const originalFilename = cloudKey.split('/').pop() || 'download'
    const contentType = getContentType(originalFilename)

    logger.info('Cloud file served', {
      userId,
      key: cloudKey,
      size: fileBuffer.length,
      context,
    })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename: originalFilename,
    })
  } catch (error) {
    logger.error('Error downloading from cloud storage:', error)
    throw error
  }
}

function privateFileResponse(file: { buffer: Buffer; contentType: string; filename: string }) {
  const response = createFileResponse(file)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
