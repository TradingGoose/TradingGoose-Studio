import { createHash } from 'crypto'
import { db } from '@tradinggoose/db'
import { environmentVariables } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  shouldStageServerToolMutationForReview,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { encryptSecret } from '@/lib/utils-server'

interface SetEnvironmentVariablesParams {
  variables: Record<string, any> | Array<{ name: string; value: string }>
}

const EnvVarSchema = z.object({ variables: z.record(z.string()) })

function hashEnvironmentVariableBase(entries: Array<[string, string | null]>): string {
  return createHash('sha256')
    .update(JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right))))
    .digest('hex')
}

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

      const userId = context.userId
      const { variables } = params || ({} as SetEnvironmentVariablesParams)

      const normalized = normalizeEnvVarInput(variables || {})
      const { variables: validatedVariables } = EnvVarSchema.parse({ variables: normalized })
      const variableEntries = Object.entries(validatedVariables)
      throwIfServerToolAborted(context)

      const existingRows = await db
        .select({ key: environmentVariables.key, value: environmentVariables.value })
        .from(environmentVariables)
        .where(eq(environmentVariables.userId, userId))

      const existingKeySet = new Set(existingRows.map((row) => row.key))
      const existingValueByKey = new Map(existingRows.map((row) => [row.key, row.value]))
      const added = variableEntries.filter(([key]) => !existingKeySet.has(key)).map(([key]) => key)
      const updated = variableEntries.filter(([key]) => existingKeySet.has(key)).map(([key]) => key)

      if (shouldStageServerToolMutationForReview(context)) {
        const variableNames = Object.keys(validatedVariables)
        return {
          requiresReview: true,
          success: true,
          message: `Review required for ${variableNames.length} environment variable(s): ${added.length} added, ${updated.length} updated`,
          variableCount: variableNames.length,
          variableNames,
          totalVariableCount: existingRows.length + added.length,
          addedVariables: added,
          updatedVariables: updated,
          reviewBaseStateHash: hashEnvironmentVariableBase(
            variableEntries.map(([key]) => [key, existingValueByKey.get(key) ?? null])
          ),
        }
      }

      await db.transaction(async (tx) => {
        for (const [key, val] of variableEntries) {
          throwIfServerToolAborted(context)
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
