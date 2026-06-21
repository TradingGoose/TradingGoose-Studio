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
import { encryptSecret } from '@/lib/utils-server'

interface SetEnvironmentVariablesParams {
  variables: Record<string, unknown>
}

const EnvVarSchema = z.object({ variables: z.record(z.string()) })

function hashEnvironmentVariableBase(entries: Array<[string, string | null]>): string {
  return createHash('sha256')
    .update(JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right))))
    .digest('hex')
}

function normalizeEnvVarInput(input: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input || {}).map(([k, v]) => [k, String(v ?? '')])
  ) as Record<string, string>
}

function parseEnvironmentVariablesPayload(payload: unknown): Record<string, string> {
  const variables =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as SetEnvironmentVariablesParams).variables
      : undefined
  return EnvVarSchema.parse({ variables: normalizeEnvVarInput(variables) }).variables
}

async function readEnvironmentVariableSummary(userId: string, variableNames: string[]) {
  const existingRows = await db
    .select({ key: environmentVariables.key, value: environmentVariables.value })
    .from(environmentVariables)
    .where(eq(environmentVariables.userId, userId))
  const existingKeySet = new Set(existingRows.map((row) => row.key))
  const existingValueByKey = new Map(existingRows.map((row) => [row.key, row.value]))
  const added = variableNames.filter((key) => !existingKeySet.has(key))
  const updated = variableNames.filter((key) => existingKeySet.has(key))

  return { existingRows, existingValueByKey, added, updated }
}

function buildEnvironmentVariablesResult(
  variableNames: string[],
  summary: Awaited<ReturnType<typeof readEnvironmentVariableSummary>>,
  messagePrefix: string
) {
  return {
    message: `${messagePrefix} ${variableNames.length} environment variable(s): ${summary.added.length} added, ${summary.updated.length} updated`,
    variableCount: variableNames.length,
    variableNames,
    totalVariableCount: summary.existingRows.length + summary.added.length,
    addedVariables: summary.added,
    updatedVariables: summary.updated,
  }
}

async function encryptEnvironmentVariables(
  variables: Record<string, string>,
  context?: ServerToolExecutionContext
): Promise<Record<string, string>> {
  const encryptedVariables: Record<string, string> = {}
  for (const [key, value] of Object.entries(variables)) {
    throwIfServerToolAborted(context)
    encryptedVariables[key] = (await encryptSecret(value)).encrypted
  }
  return encryptedVariables
}

async function writeEncryptedEnvironmentVariables(
  userId: string,
  encryptedVariables: Record<string, string>,
  context?: ServerToolExecutionContext
) {
  await db.transaction(async (tx) => {
    for (const [key, encrypted] of Object.entries(encryptedVariables)) {
      throwIfServerToolAborted(context)
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
}

export async function buildEnvironmentVariablesReviewPayload(
  payload: unknown,
  context?: ServerToolExecutionContext
) {
  const variables = parseEnvironmentVariablesPayload(payload)
  return {
    payload: { variables: Object.fromEntries(Object.keys(variables).map((key) => [key, ''])) },
    encryptedVariables: await encryptEnvironmentVariables(variables, context),
  }
}

export async function applyEncryptedEnvironmentVariablesForUser(
  userId: string,
  encryptedVariables: Record<string, string>,
  context?: ServerToolExecutionContext
) {
  const variableNames = Object.keys(encryptedVariables)
  const summary = await readEnvironmentVariableSummary(userId, variableNames)
  await writeEncryptedEnvironmentVariables(userId, encryptedVariables, context)
  return buildEnvironmentVariablesResult(variableNames, summary, 'Successfully processed')
}

export const setEnvironmentVariablesServerTool: BaseServerTool<SetEnvironmentVariablesParams, any> =
  {
    name: 'set_environment_variables',
    async execute(
      params: SetEnvironmentVariablesParams,
      context?: ServerToolExecutionContext
    ): Promise<any> {
      if (!context?.userId) {
        throw new Error('Authentication required')
      }

      const userId = context.userId
      const validatedVariables = parseEnvironmentVariablesPayload(params)
      const variableNames = Object.keys(validatedVariables)
      throwIfServerToolAborted(context)

      const summary = await readEnvironmentVariableSummary(userId, variableNames)

      if (shouldStageServerToolMutationForReview(context)) {
        return {
          requiresReview: true,
          success: true,
          ...buildEnvironmentVariablesResult(variableNames, summary, 'Review required for'),
          reviewBaseStateHash: hashEnvironmentVariableBase(
            variableNames.map((key) => [key, summary.existingValueByKey.get(key) ?? null])
          ),
        }
      }

      const encryptedVariables = await encryptEnvironmentVariables(validatedVariables, context)
      await writeEncryptedEnvironmentVariables(userId, encryptedVariables, context)
      return buildEnvironmentVariablesResult(variableNames, summary, 'Successfully processed')
    },
  }
