import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import { getOAuthAccessTokenForUserCredential } from '@/lib/credentials/oauth'
import { createLogger } from '@/lib/logs/console/logger'
import { executeTool } from '@/tools'

interface ListGDriveFilesParams {
  workspaceId?: string
  credentialId?: string
  search_query?: string
  num_results?: number
}

export const listGDriveFilesServerTool: BaseServerTool<ListGDriveFilesParams, any> = {
  name: 'list_gdrive_files',
  async execute(params: ListGDriveFilesParams, context?: ServerToolExecutionContext): Promise<any> {
    const logger = createLogger('ListGDriveFilesServerTool')
    const scopedContext = withWorkspaceArgContext(context, params)
    const { credentialId, search_query, num_results } = params || {}
    const { userId: uid, workspaceId } = await verifyWorkspaceContext(scopedContext, 'read')
    if (!credentialId) throw new Error('credentialId is required')
    throwIfServerToolAborted(scopedContext)

    const query = search_query
    const pageSize = num_results

    const accessToken = await getOAuthAccessTokenForUserCredential({
      credentialId,
      userId: uid,
      requestId: `copilot-gdrive-list-${credentialId}`,
      workspaceId,
    })
    if (!accessToken) {
      throw new Error(
        'No Google Drive connection found for this user. Please connect Google Drive in settings.'
      )
    }

    const result = await executeTool(
      'google_drive_list',
      {
        accessToken,
        ...(query ? { query } : {}),
        ...(typeof pageSize === 'number' ? { pageSize } : {}),
      },
      false,
      undefined,
      { signal: scopedContext?.signal }
    )
    throwIfServerToolAborted(scopedContext)
    if (!result.success) {
      throw new Error(result.error || 'Failed to list Google Drive files')
    }
    const output = (result as any).output || result
    const files = Array.isArray(output?.files) ? output.files : output?.output?.files || []
    const nextPageToken = output?.nextPageToken || output?.output?.nextPageToken
    logger.info('Listed Google Drive files', {
      count: files.length,
      workspaceId,
    })
    return { files, total: files.length, nextPageToken }
  },
}
