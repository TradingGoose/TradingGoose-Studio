import { CopilotTool } from '@/lib/copilot/registry'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

interface ReadEnvironmentVariablesParams {
  workspaceId?: string
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

    const scopedContext = withWorkspaceArgContext(context, params)

    if (!scopedContext?.userId) {
      logger.error(
        'Unauthorized attempt to access environment variables - no authenticated user context'
      )
      throw new Error('Authentication required')
    }

    const userId = scopedContext.userId
    const workspaceId = scopedContext.workspaceId
    if (!workspaceId) {
      throw new Error('workspaceId is required')
    }

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
      throw new Error('Access denied: You do not have permission to use this workspace')
    }

    logger.info('Reading environment variables for authenticated user', {
      userId,
      workspaceId,
    })

    const envResult = await getPersonalAndWorkspaceEnv(userId, workspaceId)
    const variableNames = [
      ...new Set([
        ...Object.keys(envResult.personalEncrypted),
        ...Object.keys(envResult.workspaceEncrypted),
      ]),
    ]
    logger.info('Environment variable keys retrieved', {
      userId,
      variableCount: variableNames.length,
    })
    return {
      variableNames,
      count: variableNames.length,
    }
  },
}
