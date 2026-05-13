import { CopilotTool } from '@/lib/copilot/registry'
import { createPermissionError } from '@/lib/copilot/review-sessions/permissions'
import {
  type BaseServerTool,
  resolveServerWorkflowScope,
  type ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { listOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import { createLogger } from '@/lib/logs/console/logger'

interface ReadOAuthCredentialsParams {
  workflowId?: string
}

export const readOAuthCredentialsServerTool: BaseServerTool<ReadOAuthCredentialsParams, any> = {
  name: CopilotTool.read_oauth_credentials,
  async execute(
    params: ReadOAuthCredentialsParams,
    context?: ServerToolExecutionContext
  ): Promise<any> {
    const logger = createLogger('ReadOAuthCredentialsServerTool')

    if (!context?.userId) {
      logger.error(
        'Unauthorized attempt to access OAuth credentials - no authenticated user context'
      )
      throw new Error('Authentication required')
    }

    const authenticatedUserId = context.userId

    const workflowScope = await resolveServerWorkflowScope(params, context)
    if (workflowScope && !workflowScope.hasAccess) {
      const errorMessage = createPermissionError('access credentials in')
      logger.error('Unauthorized attempt to access OAuth credentials', {
        workflowId: workflowScope.workflowId,
        authenticatedUserId,
      })
      throw new Error(errorMessage)
    }

    const userId = authenticatedUserId

    logger.info('Reading OAuth credentials for authenticated user', {
      userId,
      workflowId: workflowScope?.workflowId,
    })
    const credentials = await listOAuthCredentialsForUser({
      userId,
      workspaceId: workflowScope?.workspaceId,
    })
    logger.info('Fetched OAuth credentials', { userId, count: credentials.length })
    return { credentials, total: credentials.length }
  },
}
