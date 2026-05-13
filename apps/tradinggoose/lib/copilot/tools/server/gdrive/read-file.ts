import { createPermissionError } from '@/lib/copilot/review-sessions/permissions'
import {
  type BaseServerTool,
  resolveServerWorkflowScope,
  type ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getOAuthAccessTokenForUserCredential } from '@/lib/credentials/oauth'
import { createLogger } from '@/lib/logs/console/logger'
import { executeTool } from '@/tools'

interface ReadGDriveFileParams {
  workflowId?: string
  credentialId?: string
  fileId?: string
  type?: 'doc' | 'sheet'
  range?: string
}

export const readGDriveFileServerTool: BaseServerTool<ReadGDriveFileParams, any> = {
  name: 'read_gdrive_file',
  async execute(params: ReadGDriveFileParams, context?: ServerToolExecutionContext): Promise<any> {
    const logger = createLogger('ReadGDriveFileServerTool')

    const userId = context?.userId
    const credentialId = params?.credentialId
    const fileId = params?.fileId
    const type = params?.type
    const workflowScope = await resolveServerWorkflowScope(params, context)

    logger.info('read_gdrive_file input', {
      hasUserId: !!userId,
      workflowId: workflowScope?.workflowId,
      hasCredentialId: !!credentialId,
      hasFileId: !!fileId,
      type,
      hasRange: !!params?.range,
    })

    if (!userId || !credentialId || !fileId || !type) {
      throw new Error('Authentication, credentialId, fileId and type are required')
    }
    if (workflowScope && !workflowScope.hasAccess) {
      throw new Error(createPermissionError('access Google Drive files in'))
    }

    if (type === 'doc') {
      const accessToken = await getOAuthAccessTokenForUserCredential({
        credentialId,
        userId,
        requestId: `copilot-gdrive-read-${credentialId}`,
        workspaceId: workflowScope?.workspaceId,
      })
      if (!accessToken)
        throw new Error(
          'No Google Drive connection found for this user. Please connect Google Drive in settings.'
        )
      const result = await executeTool('google_drive_get_content', { accessToken, fileId })
      if (!result.success) throw new Error(result.error || 'Failed to read Google Drive document')
      const output = (result as any).output || result
      const content = output?.output?.content ?? output?.content
      const metadata = output?.output?.metadata ?? output?.metadata
      return { type, content, metadata }
    }

    if (type === 'sheet') {
      const accessToken = await getOAuthAccessTokenForUserCredential({
        credentialId,
        userId,
        requestId: `copilot-gdrive-read-${credentialId}`,
        workspaceId: workflowScope?.workspaceId,
      })
      if (!accessToken)
        throw new Error(
          'No Google Sheets connection found for this user. Please connect Google Sheets in settings.'
        )
      const result = await executeTool('google_sheets_read', {
        accessToken,
        spreadsheetId: fileId,
        ...(params?.range ? { range: params.range } : {}),
      })
      if (!result.success) throw new Error(result.error || 'Failed to read Google Sheets data')
      const output = (result as any).output || result
      const rows: string[][] = output?.output?.data?.values || output?.data?.values || []
      const resolvedRange: string | undefined = output?.output?.data?.range || output?.data?.range
      const metadata = output?.output?.metadata || output?.metadata
      return { type, rows, range: resolvedRange, metadata }
    }

    throw new Error(`Unsupported type: ${type}`)
  },
}
