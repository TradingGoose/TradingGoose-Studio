import { CopilotTool } from '@/lib/copilot/registry'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import {
  listOAuthConnectionsForUser,
  listOAuthCredentialsForUser,
} from '@/lib/credentials/oauth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

type ReadOAuthCredentialsParams =
  | { scope: 'personal' }
  | { scope: 'workspace'; workspaceId: string }

export const readOAuthCredentialsServerTool: BaseServerTool<ReadOAuthCredentialsParams, any> = {
  name: CopilotTool.read_oauth_credentials,
  async execute(
    params: ReadOAuthCredentialsParams,
    context?: ServerToolExecutionContext
  ): Promise<any> {
    const logger = createLogger('ReadOAuthCredentialsServerTool')

    if (!context?.userId) {
      throw new Error('Authentication required')
    }

    const userId = context.userId
    if (params.scope === 'personal') {
      const credentials = await listOAuthConnectionsForUser({ userId })
      logger.info('Fetched personal OAuth credentials', { userId, count: credentials.length })
      return { credentials, total: credentials.length }
    }

    const scopedContext = withWorkspaceArgContext(context, params)
    const workspaceId = scopedContext?.workspaceId
    if (!workspaceId) throw new Error('workspaceId is required')

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
      throw new Error('Access denied: You do not have permission to use this workspace')
    }

    logger.info('Reading OAuth credentials for authenticated user', {
      userId,
      workspaceId,
    })
    const credentials = await listOAuthCredentialsForUser({
      userId,
      workspaceId,
    })
    logger.info('Fetched OAuth credentials', { userId, count: credentials.length })
    return { credentials, total: credentials.length }
  },
}
