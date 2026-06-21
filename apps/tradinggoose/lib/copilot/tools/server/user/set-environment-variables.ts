import { db } from '@tradinggoose/db'
import { environmentVariables } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  assertAcceptedServerToolReviewBase,
  type BaseServerTool,
  hashServerToolReviewBase,
  type ServerToolExecutionContext,
  shouldStageServerToolMutationForReview,
  throwIfServerToolAborted,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { encryptSecret } from '@/lib/utils-server'

interface SetEnvironmentVariablesParams {
  workspaceId?: string
  variables: Record<string, unknown>
}

const EnvVarSchema = z.object({
  workspaceId: z.string().optional(),
  variables: z.record(z.string()),
})

function hashEnvironmentVariableBase(entries: Array<[string, string | null]>): string {
  return hashServerToolReviewBase(entries.sort(([left], [right]) => left.localeCompare(right)))
}

function normalizeEnvVarInput(input: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input || {}).map(([k, v]) => [k, String(v ?? '')])
  ) as Record<string, string>
}

function parseEnvironmentVariablesPayload(payload: unknown): {
  workspaceId?: string
  variables: Record<string, string>
} {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as SetEnvironmentVariablesParams)
      : undefined
  const parsed = EnvVarSchema.parse({
    workspaceId: record?.workspaceId,
    variables: normalizeEnvVarInput(record?.variables),
  })
  return parsed
}

async function readEnvironmentVariableSummary(workspaceId: string, variableNames: string[]) {
  const existingRows = await db
    .select({ key: environmentVariables.key, value: environmentVariables.value })
    .from(environmentVariables)
    .where(eq(environmentVariables.workspaceId, workspaceId))
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
  workspaceId: string,
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
          workspaceId,
          key,
          value: encrypted,
        })
        .onConflictDoUpdate({
          target: [environmentVariables.workspaceId, environmentVariables.key],
          set: {
            value: encrypted,
            updatedAt: new Date(),
          },
        })
    }
  })
}

export const setEnvironmentVariablesServerTool: BaseServerTool<SetEnvironmentVariablesParams, any> =
  {
    name: 'set_environment_variables',
    async execute(
      params: SetEnvironmentVariablesParams,
      context?: ServerToolExecutionContext
    ): Promise<any> {
      const parsedPayload = parseEnvironmentVariablesPayload(params)
      const scopedContext = withWorkspaceArgContext(context, parsedPayload)
      if (!scopedContext?.userId) {
        throw new Error('Authentication required')
      }

      const userId = scopedContext.userId
      const workspaceId = scopedContext.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required')
      }
      const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
      if (!workspaceAccess.exists || !workspaceAccess.hasAccess || !workspaceAccess.canWrite) {
        throw new Error('Access denied: You do not have permission to edit this workspace')
      }

      const validatedVariables = parsedPayload.variables
      const variableNames = Object.keys(validatedVariables)
      throwIfServerToolAborted(scopedContext)

      const summary = await readEnvironmentVariableSummary(workspaceId, variableNames)
      const reviewBaseStateHash = hashEnvironmentVariableBase(
        variableNames.map((key) => [key, summary.existingValueByKey.get(key) ?? null])
      )

      if (shouldStageServerToolMutationForReview(scopedContext)) {
        return {
          requiresReview: true,
          success: true,
          ...buildEnvironmentVariablesResult(variableNames, summary, 'Review required for'),
          reviewBaseStateHash,
        }
      }

      assertAcceptedServerToolReviewBase(scopedContext, reviewBaseStateHash)
      const encryptedVariables = await encryptEnvironmentVariables(
        validatedVariables,
        scopedContext
      )
      await writeEncryptedEnvironmentVariables(workspaceId, encryptedVariables, scopedContext)
      return buildEnvironmentVariablesResult(variableNames, summary, 'Successfully processed')
    },
  }
