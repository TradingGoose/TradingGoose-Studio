import { CopilotTool } from '@/lib/copilot/registry'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

type ReadEnvironmentVariablesParams =
  | { scope: 'personal' }
  | { scope: 'workspace'; workspaceId: string }

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
      throw new Error('Authentication required')
    }

    const userId = context.userId
    const scopedContext =
      params.scope === 'workspace' ? withWorkspaceArgContext(context, params) : context
    const workspaceId = params.scope === 'workspace' ? scopedContext?.workspaceId : undefined
    if (params.scope === 'workspace') {
      if (!workspaceId) throw new Error('workspaceId is required')
      const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
      if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
        throw new Error('Access denied: You do not have permission to use this workspace')
      }
    }

    logger.info('Reading environment variables for authenticated user', {
      userId,
      scope: params.scope,
      workspaceId,
    })

    const envResult = await getPersonalAndWorkspaceEnv(userId, workspaceId)
    const personalVariableNames = Object.keys(envResult.personalEncrypted)
    const workspaceVariableNames = Object.keys(envResult.workspaceEncrypted)
    const variableNames = [...new Set([...personalVariableNames, ...workspaceVariableNames])]
    logger.info('Environment variable keys retrieved', {
      userId,
      variableCount: variableNames.length,
    })
    return {
      variableNames,
      personalVariableNames,
      workspaceVariableNames,
      conflicts: envResult.conflicts,
      count: variableNames.length,
    }
  },
}
