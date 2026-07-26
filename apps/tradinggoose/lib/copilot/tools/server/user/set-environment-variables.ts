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
import { verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import { encryptSecret } from '@/lib/utils-server'

const EnvVarSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('personal'),
      variables: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      scope: z.literal('workspace'),
      workspaceId: z.string().min(1),
      variables: z.record(z.string(), z.string()),
    })
    .strict(),
])
type SetEnvironmentVariablesParams = z.infer<typeof EnvVarSchema>

function hashEnvironmentVariableBase(
  scope: 'personal' | 'workspace',
  targetId: string,
  entries: Array<[string, string | null]>
): string {
  return hashServerToolReviewBase({
    scope,
    targetId,
    entries: entries.sort(([left], [right]) => left.localeCompare(right)),
  })
}

async function readEnvironmentVariableSummary(
  scope: 'personal' | 'workspace',
  targetId: string,
  variableNames: string[]
) {
  const existingRows = await db
    .select({ key: environmentVariables.key, value: environmentVariables.value })
    .from(environmentVariables)
    .where(
      scope === 'workspace'
        ? eq(environmentVariables.workspaceId, targetId)
        : eq(environmentVariables.userId, targetId)
    )
  const existingKeySet = new Set(existingRows.map((row) => row.key))
  const existingValueByKey = new Map(existingRows.map((row) => [row.key, row.value]))
  const added = variableNames.filter((key) => !existingKeySet.has(key))
  const updated = variableNames.filter((key) => existingKeySet.has(key))

  return { existingRows, existingValueByKey, added, updated }
}

function buildEnvironmentVariablesResult(
  scope: 'personal' | 'workspace',
  workspaceId: string | undefined,
  variableNames: string[],
  summary: Awaited<ReturnType<typeof readEnvironmentVariableSummary>>,
  messagePrefix: string
) {
  return {
    success: true,
    scope,
    workspaceId,
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
  scope: 'personal' | 'workspace',
  targetId: string,
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
          ...(scope === 'workspace' ? { workspaceId: targetId } : { userId: targetId }),
          key,
          value: encrypted,
        })
        .onConflictDoUpdate({
          target:
            scope === 'workspace'
              ? [environmentVariables.workspaceId, environmentVariables.key]
              : [environmentVariables.userId, environmentVariables.key],
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
      const parsedPayload = EnvVarSchema.parse(params)
      const scopedContext =
        parsedPayload.scope === 'workspace'
          ? withWorkspaceArgContext(context, parsedPayload)
          : context
      if (!scopedContext?.userId) {
        throw new Error('Authentication required')
      }

      const userId = scopedContext.userId
      const workspaceId =
        parsedPayload.scope === 'workspace' ? scopedContext.workspaceId : undefined
      const targetId = workspaceId ?? userId
      if (parsedPayload.scope === 'workspace') {
        await verifyWorkspaceContext(scopedContext, 'write')
      }

      const variableNames = Object.keys(parsedPayload.variables).sort()
      throwIfServerToolAborted(scopedContext)

      const summary = await readEnvironmentVariableSummary(
        parsedPayload.scope,
        targetId,
        variableNames
      )
      const reviewBaseStateHash = hashEnvironmentVariableBase(
        parsedPayload.scope,
        targetId,
        variableNames.map((key) => [key, summary.existingValueByKey.get(key) ?? null])
      )

      if (shouldStageServerToolMutationForReview(scopedContext)) {
        return {
          requiresReview: true,
          ...buildEnvironmentVariablesResult(
            parsedPayload.scope,
            workspaceId,
            variableNames,
            summary,
            'Review required for'
          ),
          reviewBaseStateHash,
        }
      }

      assertAcceptedServerToolReviewBase(scopedContext, reviewBaseStateHash)
      const encryptedVariables = await encryptEnvironmentVariables(
        parsedPayload.variables,
        scopedContext
      )
      await writeEncryptedEnvironmentVariables(
        parsedPayload.scope,
        targetId,
        encryptedVariables,
        scopedContext
      )
      return buildEnvironmentVariablesResult(
        parsedPayload.scope,
        workspaceId,
        variableNames,
        summary,
        'Successfully processed'
      )
    },
  }
