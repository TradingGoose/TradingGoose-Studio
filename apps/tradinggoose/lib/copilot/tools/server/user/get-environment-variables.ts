import { createPermissionError } from '@/lib/copilot/review-sessions/permissions'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  resolveServerWorkflowScope,
} from '@/lib/copilot/tools/server/base-tool'
import { getEnvironmentVariableKeys, getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'

interface GetEnvironmentVariablesParams {
  workflowId?: string
}

export const getEnvironmentVariablesServerTool: BaseServerTool<GetEnvironmentVariablesParams, any> =
  {
    name: 'get_environment_variables',
    async execute(
      params: GetEnvironmentVariablesParams,
      context?: ServerToolExecutionContext
    ): Promise<any> {
      const logger = createLogger('GetEnvironmentVariablesServerTool')

      if (!context?.userId) {
        logger.error(
          'Unauthorized attempt to access environment variables - no authenticated user context'
        )
        throw new Error('Authentication required')
      }

      const authenticatedUserId = context.userId

      const workflowScope = await resolveServerWorkflowScope(params, context)
      if (workflowScope && !workflowScope.hasAccess) {
        const errorMessage = createPermissionError('access environment variables in')
        logger.error('Unauthorized attempt to access environment variables', {
          workflowId: workflowScope.workflowId,
          authenticatedUserId,
        })
        throw new Error(errorMessage)
      }

      const userId = authenticatedUserId

      logger.info('Getting environment variables for authenticated user', {
        userId,
        workflowId: workflowScope?.workflowId,
        workspaceId: workflowScope?.workspaceId,
      })

      if (workflowScope?.workspaceId) {
        const envResult = await getPersonalAndWorkspaceEnv(userId, workflowScope.workspaceId)
        const variableNames = [
          ...new Set([
            ...Object.keys(envResult.personalEncrypted),
            ...Object.keys(envResult.workspaceEncrypted),
          ]),
        ]
        logger.info('Environment variable keys retrieved', {
          userId,
          workflowId: workflowScope.workflowId,
          variableCount: variableNames.length,
        })
        return {
          variableNames,
          count: variableNames.length,
        }
      }

      const result = await getEnvironmentVariableKeys(userId)
      logger.info('Environment variable keys retrieved', { userId, variableCount: result.count })
      return {
        variableNames: result.variableNames,
        count: result.count,
      }
    },
  }
