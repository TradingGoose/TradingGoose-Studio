import { db } from '@tradinggoose/db'
import { environmentVariables } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { ToolArgSchemas } from '@/lib/copilot/registry'
import {
  assertAcceptedServerToolReviewBase,
  type BaseServerTool,
  hashServerToolReviewBase,
  type ServerToolExecutionContext,
  shouldStageServerToolMutationForReview,
  throwIfServerToolAborted,
  throwStaleServerToolReview,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import { encryptSecret } from '@/lib/utils-server'

const EnvVarSchema = ToolArgSchemas.set_environment_variables
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
  variableNames: string[],
  store: Pick<typeof db, 'select'> = db
) {
  const existingRows = await store
    .select({ key: environmentVariables.key, value: environmentVariables.value })
    .from(environmentVariables)
    .where(
      scope === 'workspace'
        ? eq(environmentVariables.workspaceId, targetId)
        : eq(environmentVariables.userId, targetId)
    )
  const existingValueByKey = new Map(existingRows.map((row) => [row.key, row.value]))
  const added = variableNames.filter((key) => !existingValueByKey.has(key))
  const updated = variableNames.filter((key) => existingValueByKey.has(key))

  return {
    existingValueByKey,
    added,
    updated,
    totalVariableCount: existingRows.length + added.length,
    reviewBaseStateHash: hashEnvironmentVariableBase(
      scope,
      targetId,
      variableNames.map((key) => [key, existingValueByKey.get(key) ?? null])
    ),
  }
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
    totalVariableCount: summary.totalVariableCount,
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
  variableNames: string[],
  context?: ServerToolExecutionContext
) {
  const scopeColumn =
    scope === 'workspace' ? environmentVariables.workspaceId : environmentVariables.userId
  const target = [scopeColumn, environmentVariables.key]
  return db.transaction(async (tx) => {
    const summary = await readEnvironmentVariableSummary(scope, targetId, variableNames, tx)
    assertAcceptedServerToolReviewBase(context, summary.reviewBaseStateHash)
    for (const key of variableNames) {
      throwIfServerToolAborted(context)
      const value = encryptedVariables[key]!
      const set = { value, updatedAt: new Date() }
      const previous = summary.existingValueByKey.get(key)
      let written
      if (context?.acceptedReviewBaseStateHash && previous !== undefined) {
        written = await tx
          .update(environmentVariables)
          .set(set)
          .where(
            and(
              eq(scopeColumn, targetId),
              eq(environmentVariables.key, key),
              eq(environmentVariables.value, previous)
            )
          )
          .returning({ id: environmentVariables.id })
      } else {
        const insert = tx.insert(environmentVariables).values({
          id: crypto.randomUUID(),
          ...(scope === 'workspace' ? { workspaceId: targetId } : { userId: targetId }),
          key,
          value,
        })
        if (!context?.acceptedReviewBaseStateHash) {
          await insert.onConflictDoUpdate({ target, set })
          continue
        }
        written = await insert
          .onConflictDoNothing({ target })
          .returning({ id: environmentVariables.id })
      }
      if (!written.length) throwStaleServerToolReview()
    }
    return summary
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

      if (shouldStageServerToolMutationForReview(scopedContext)) {
        const summary = await readEnvironmentVariableSummary(
          parsedPayload.scope,
          targetId,
          variableNames
        )
        return {
          requiresReview: true,
          ...buildEnvironmentVariablesResult(
            parsedPayload.scope,
            workspaceId,
            variableNames,
            summary,
            'Review required for'
          ),
          reviewBaseStateHash: summary.reviewBaseStateHash,
        }
      }

      const encryptedVariables = await encryptEnvironmentVariables(
        parsedPayload.variables,
        scopedContext
      )
      const summary = await writeEncryptedEnvironmentVariables(
        parsedPayload.scope,
        targetId,
        encryptedVariables,
        variableNames,
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
