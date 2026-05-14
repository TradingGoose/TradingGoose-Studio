import { CopilotTool } from '@/lib/copilot/registry'
import {
  type BaseServerTool,
  createPermissionError,
  resolveServerWorkflowScope,
  type ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getEnvironmentVariableKeys, getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'

interface ReadEnvironmentVariablesParams {
  workflowId?: string
}

export const readEnvironmentVariablesServerTool: BaseServerTool<
  ReadEnvironmentVariablesParams,
  any
> = {
  name: CopilotTool.read_environment_variables,
  async execute(
    params: ReadEnvironmentVariablesParams,
    context?: ServerToolExecutionContext
  ): Promise<any> {
    const logger = createLogger('ReadEnvironmentVariablesServerTool')

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

    logger.info('Reading environment variables for authenticated user', {
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
