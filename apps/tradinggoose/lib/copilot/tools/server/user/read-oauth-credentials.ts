import { CopilotTool } from '@/lib/copilot/registry'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { requireUserId, verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import { listOAuthConnectionsForUser, listOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import { createLogger } from '@/lib/logs/console/logger'

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

    const userId = requireUserId(context)
    if (params.scope === 'personal') {
      const credentials = await listOAuthConnectionsForUser({ userId })
      logger.info('Fetched personal OAuth credentials', { userId, count: credentials.length })
      return { credentials, total: credentials.length }
    }

    const scopedContext = withWorkspaceArgContext(context, params)
    const { workspaceId } = await verifyWorkspaceContext(scopedContext, 'read')

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
