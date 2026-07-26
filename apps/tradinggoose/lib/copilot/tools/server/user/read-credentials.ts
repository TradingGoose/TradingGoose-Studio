import { CopilotTool } from '@/lib/copilot/registry'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { requireUserId, verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import { listOAuthConnectionsForUser, listOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'

type ReadCredentialsParams = { scope: 'personal' } | { scope: 'workspace'; workspaceId: string }

export const readCredentialsServerTool: BaseServerTool<ReadCredentialsParams, any> = {
  name: CopilotTool.read_credentials,
  async execute(params: ReadCredentialsParams, context?: ServerToolExecutionContext): Promise<any> {
    const logger = createLogger('ReadCredentialsServerTool')

    const scopedContext =
      params.scope === 'workspace' ? withWorkspaceArgContext(context, params) : context
    const scope =
      params.scope === 'workspace'
        ? await verifyWorkspaceContext(scopedContext, 'read')
        : { userId: requireUserId(context), workspaceId: undefined }
    const { userId, workspaceId } = scope

    logger.info('Fetching credentials for authenticated user', {
      userId,
      scope: params.scope,
      workspaceId,
    })

    // Get all available OAuth services
    const allOAuthServices = Object.values(OAUTH_PROVIDERS).flatMap((provider) =>
      Object.values(provider.services).map((service) => ({
        providerId: service.providerId,
        name: service.name,
        description: service.description,
        baseProvider: provider.id,
      }))
    )

    // Track connected provider IDs
    const connectedProviderIds = new Set<string>()
    const rawCredentials =
      params.scope === 'workspace'
        ? await listOAuthCredentialsForUser({
            userId,
            workspaceId,
          })
        : await listOAuthConnectionsForUser({ userId })

    const connectedCredentials = rawCredentials.map((credential) => {
      connectedProviderIds.add(credential.provider)
      const service = allOAuthServices.find((entry) => entry.providerId === credential.provider)
      return {
        ...credential,
        serviceName: service?.name ?? credential.provider,
      }
    })

    // Build list of not connected services
    const notConnectedServices = allOAuthServices
      .filter((service) => !connectedProviderIds.has(service.providerId))
      .map((service) => ({
        providerId: service.providerId,
        name: service.name,
        description: service.description,
        baseProvider: service.baseProvider,
      }))

    // Fetch environment variables from both personal and workspace
    const envResult = await getPersonalAndWorkspaceEnv(userId, workspaceId)

    // Get all unique variable names from both personal and workspace
    const personalVarNames = Object.keys(envResult.personalEncrypted)
    const workspaceVarNames = Object.keys(envResult.workspaceEncrypted)
    const allVarNames = [...new Set([...personalVarNames, ...workspaceVarNames])]

    logger.info('Fetched credentials', {
      userId,
      workspaceId,
      connectedCount: connectedCredentials.length,
      notConnectedCount: notConnectedServices.length,
      personalEnvVarCount: personalVarNames.length,
      workspaceEnvVarCount: workspaceVarNames.length,
      totalEnvVarCount: allVarNames.length,
      conflicts: envResult.conflicts,
    })

    return {
      oauth: {
        connected: {
          credentials: connectedCredentials,
          total: connectedCredentials.length,
        },
        notConnected: {
          services: notConnectedServices,
          total: notConnectedServices.length,
        },
      },
      environment: {
        variableNames: allVarNames,
        count: allVarNames.length,
        personalVariables: personalVarNames,
        workspaceVariables: workspaceVarNames,
        conflicts: envResult.conflicts,
      },
    }
  },
}
