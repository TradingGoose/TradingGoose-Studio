import { CopilotTool } from '@/lib/copilot/registry'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { requireUserId, verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'

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

    const scopedContext =
      params.scope === 'workspace' ? withWorkspaceArgContext(context, params) : context
    const scope =
      params.scope === 'workspace'
        ? await verifyWorkspaceContext(scopedContext, 'read')
        : { userId: requireUserId(context), workspaceId: undefined }
    const { userId, workspaceId } = scope

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
