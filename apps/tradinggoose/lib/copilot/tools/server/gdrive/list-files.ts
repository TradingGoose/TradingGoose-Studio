import { createPermissionError } from '@/lib/copilot/review-sessions/permissions'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  resolveServerWorkflowScope,
} from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { executeTool } from '@/tools'

interface ListGDriveFilesParams {
  workflowId?: string
  search_query?: string
  num_results?: number
}

export const listGDriveFilesServerTool: BaseServerTool<ListGDriveFilesParams, any> = {
  name: 'list_gdrive_files',
  async execute(params: ListGDriveFilesParams, context?: ServerToolExecutionContext): Promise<any> {
    const logger = createLogger('ListGDriveFilesServerTool')
    const { search_query, num_results } = params || {}
    const uid = context?.userId
    if (!uid || typeof uid !== 'string' || uid.trim().length === 0) {
      throw new Error('Authentication required')
    }

    const workflowScope = await resolveServerWorkflowScope(params, context)
    if (workflowScope && !workflowScope.hasAccess) {
      throw new Error(createPermissionError('access Google Drive files in'))
    }

    const query = search_query
    const pageSize = num_results

    const accessToken = await getOAuthToken(uid, 'google-drive')
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
      }
    )
    if (!result.success) {
      throw new Error(result.error || 'Failed to list Google Drive files')
    }
    const output = (result as any).output || result
    const files = Array.isArray(output?.files) ? output.files : output?.output?.files || []
    const nextPageToken = output?.nextPageToken || output?.output?.nextPageToken
    logger.info('Listed Google Drive files', {
      count: files.length,
      workflowId: workflowScope?.workflowId,
    })
    return { files, total: files.length, nextPageToken }
  },
}
