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

interface ReadGDriveFileParams {
  workspaceId?: string
  credentialId?: string
  fileId?: string
  type?: 'doc' | 'sheet'
  range?: string
}

export const readGDriveFileServerTool: BaseServerTool<ReadGDriveFileParams, any> = {
  name: 'read_gdrive_file',
  async execute(params: ReadGDriveFileParams, context?: ServerToolExecutionContext): Promise<any> {
    const logger = createLogger('ReadGDriveFileServerTool')
    const scopedContext = withWorkspaceArgContext(context, params)

    const credentialId = params?.credentialId
    const fileId = params?.fileId
    const type = params?.type

    logger.info('read_gdrive_file input', {
      hasUserId: !!scopedContext?.userId,
      workspaceId: scopedContext?.workspaceId,
      hasCredentialId: !!credentialId,
      hasFileId: !!fileId,
      type,
      hasRange: !!params?.range,
    })

    const { userId, workspaceId } = await verifyWorkspaceContext(scopedContext, 'read')
    if (!credentialId || !fileId || !type) {
      throw new Error('credentialId, fileId and type are required')
    }
    throwIfServerToolAborted(scopedContext)

    const accessToken = await getOAuthAccessTokenForUserCredential({
      credentialId,
      userId,
      requestId: `copilot-gdrive-read-${credentialId}`,
      workspaceId,
    })
    if (!accessToken) {
      throw new Error(
        'No Google Drive connection found for this user. Please connect Google Drive in settings.'
      )
    }

    if (type === 'doc') {
      const result = await executeTool(
        'google_drive_get_content',
        { accessToken, fileId },
        false,
        undefined,
        { signal: scopedContext?.signal }
      )
      throwIfServerToolAborted(scopedContext)
      if (!result.success) throw new Error(result.error || 'Failed to read Google Drive document')
      const output = (result as any).output || result
      const content = output?.output?.content ?? output?.content
      const metadata = output?.output?.metadata ?? output?.metadata
      return { type, content, metadata }
    }

    if (type === 'sheet') {
      const result = await executeTool(
        'google_sheets_read',
        {
          accessToken,
          spreadsheetId: fileId,
          ...(params?.range ? { range: params.range } : {}),
        },
        false,
        undefined,
        { signal: scopedContext?.signal }
      )
      throwIfServerToolAborted(scopedContext)
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
