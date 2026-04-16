import { db } from '@tradinggoose/db'
import { environmentVariables } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createPermissionError } from '@/lib/copilot/review-sessions/permissions'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { resolveServerWorkflowScope } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { encryptSecret } from '@/lib/utils-server'

interface SetEnvironmentVariablesParams {
  variables: Record<string, any> | Array<{ name: string; value: string }>
  workflowId?: string
}

const EnvVarSchema = z.object({ variables: z.record(z.string()) })

function normalizeEnvVarInput(
  input: Record<string, any> | Array<{ name: string; value: string }>
): Record<string, string> {
  if (Array.isArray(input)) {
    return input.reduce(
      (acc, item) => {
        if (item && typeof item.name === 'string') {
          acc[item.name] = String(item.value ?? '')
        }
        return acc
      },
      {} as Record<string, string>
    )
  }
  return Object.fromEntries(
    Object.entries(input || {}).map(([k, v]) => [k, String(v ?? '')])
  ) as Record<string, string>
}

export const setEnvironmentVariablesServerTool: BaseServerTool<SetEnvironmentVariablesParams, any> =
  {
    name: 'set_environment_variables',
    async execute(
      params: SetEnvironmentVariablesParams,
      context?: ServerToolExecutionContext
    ): Promise<any> {
      const logger = createLogger('SetEnvironmentVariablesServerTool')

      if (!context?.userId) {
        logger.error(
          'Unauthorized attempt to set environment variables - no authenticated user context'
        )
        throw new Error('Authentication required')
      }

      const authenticatedUserId = context.userId
      const { variables } = params || ({} as SetEnvironmentVariablesParams)

      const workflowScope = await resolveServerWorkflowScope(params, context)
      if (workflowScope && !workflowScope.hasAccess) {
        const errorMessage = createPermissionError('modify environment variables in')
        logger.error('Unauthorized attempt to set environment variables', {
          workflowId: workflowScope.workflowId,
          authenticatedUserId,
        })
        throw new Error(errorMessage)
      }

      const userId = authenticatedUserId

      const normalized = normalizeEnvVarInput(variables || {})
      const { variables: validatedVariables } = EnvVarSchema.parse({ variables: normalized })
      const variableEntries = Object.entries(validatedVariables)

      const existingRows = await db
        .select({ key: environmentVariables.key })
        .from(environmentVariables)
        .where(eq(environmentVariables.userId, userId))

      const existingKeySet = new Set(existingRows.map((row) => row.key))
      const added = variableEntries.filter(([key]) => !existingKeySet.has(key)).map(([key]) => key)
      const updated = variableEntries.filter(([key]) => existingKeySet.has(key)).map(([key]) => key)

      await db.transaction(async (tx) => {
        for (const [key, val] of variableEntries) {
          const { encrypted } = await encryptSecret(val)

          await tx
            .insert(environmentVariables)
            .values({
              id: crypto.randomUUID(),
              userId,
              key,
              value: encrypted,
            })
            .onConflictDoUpdate({
              target: [environmentVariables.userId, environmentVariables.key],
              set: {
                value: encrypted,
                updatedAt: new Date(),
              },
            })
        }
      })

      return {
        message: `Successfully processed ${Object.keys(validatedVariables).length} environment variable(s): ${added.length} added, ${updated.length} updated`,
        variableCount: Object.keys(validatedVariables).length,
        variableNames: Object.keys(validatedVariables),
        totalVariableCount: existingRows.length + added.length,
        addedVariables: added,
        updatedVariables: updated,
      }
    },
  }
