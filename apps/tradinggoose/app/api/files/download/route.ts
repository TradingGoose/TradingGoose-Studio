import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveAuthorizedWorkspaceFileReference } from '@/lib/uploads/contexts/workspace'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { generatePresignedDownloadUrl, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { assertStorageReferenceAccess, StorageAccessError } from '@/lib/uploads/utils/file-utils'
import { getBaseUrl } from '@/lib/urls/utils'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('FileDownload')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { key, name, isExecutionFile, context } = body
    if (!key) {
      return createErrorResponse(new Error('File key is required'), 400)
    }
    assertStorageReferenceAccess(key, context)
    logger.info(`Generating download URL for file: ${name || key}`)

    let storageContext: StorageContext = context || 'general'

    if (isExecutionFile && !context) {
      storageContext = 'execution'
      logger.info(`Using execution context for file: ${key}`)
    }

    const actor = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!actor.success || !actor.userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const file = await resolveAuthorizedWorkspaceFileReference(key, actor.userId)
    if (file) {
      if (file.key !== key) throw new StorageAccessError()
      const signed = await generatePresignedDownloadUrl(file.key, 'workspace', 5 * 60)
      const url = new URL(signed, request.url)
      if (url.pathname.startsWith('/api/files/serve/')) {
        url.searchParams.set('context', 'workspace')
        url.searchParams.set('workspaceId', file.workspaceId)
        url.searchParams.set('fileId', file.id)
      }
      return NextResponse.json({
        downloadUrl: url.toString(),
        expiresIn: 300,
        fileName: file.name,
      })
    }

    if (hasCloudStorage()) {
      try {
        const downloadUrl = await generatePresignedDownloadUrl(
          key,
          storageContext,
          5 * 60 // 5 minutes
        )

        logger.info(`Generated download URL for ${storageContext} file: ${key}`)

        return NextResponse.json({
          downloadUrl,
          expiresIn: 300, // 5 minutes in seconds
          fileName: name || key.split('/').pop() || 'download',
        })
      } catch (error) {
        logger.error(`Failed to generate presigned URL for ${key}:`, error)
        return createErrorResponse(
          error instanceof Error ? error : new Error('Failed to generate download URL'),
          500
        )
      }
    } else {
      const downloadUrl = `${getBaseUrl()}/api/files/serve/${encodeURIComponent(key)}?context=${storageContext}`

      logger.info(`Using local storage path for file: ${key}`)

      return NextResponse.json({
        downloadUrl,
        expiresIn: null,
        fileName: name || key.split('/').pop() || 'download',
      })
    }
  } catch (error) {
    logger.error('Error in file download endpoint:', error)
    return createErrorResponse(
      error instanceof Error ? error : new Error('Internal server error'),
      error instanceof StorageAccessError ? error.status : 500
    )
  }
}
