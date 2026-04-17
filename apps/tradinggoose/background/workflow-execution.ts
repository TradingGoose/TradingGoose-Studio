import { db } from '@tradinggoose/db'
import { workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import {
  isExecutionConcurrencyBackendUnavailableError,
  isExecutionConcurrencyLimitError,
  withExecutionConcurrencyLimit,
} from '@/lib/execution/execution-concurrency-limit'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('TriggerWorkflowExecution')

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  executionId?: string
  input?: any
  triggerType?: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  startBlockId?: string
  executionTarget?: 'deployed' | 'live'
  triggerData?: Record<string, unknown>
  metadata?: Record<string, any>
}

export function isWorkflowExecutionPayload(
  value: unknown,
): value is WorkflowExecutionPayload & Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.workflowId === 'string' &&
    typeof candidate.userId === 'string'
  )
}

export async function executeWorkflowJob(payload: WorkflowExecutionPayload) {
  const workflowId = payload.workflowId
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)

  logger.info(`[${requestId}] Starting workflow execution: ${workflowId}`, {
    userId: payload.userId,
    triggerType: payload.triggerType,
    executionId,
  })

  // Initialize logging session
  const triggerType = payload.triggerType || 'api'
  const loggingSession = new LoggingSession(
    workflowId,
    executionId,
    triggerType,
    requestId,
  )

  try {
    return await withExecutionConcurrencyLimit({
      userId: payload.userId,
      workflowId,
      task: async () => {
        const usageCheck = await checkServerSideUsageLimits({
          userId: payload.userId,
          workflowId,
        })
        if (usageCheck.isExceeded) {
          logger.warn(
            `[${requestId}] Workspace billing subject has exceeded usage limits. Skipping workflow execution.`,
            {
              actorUserId: payload.userId,
              currentUsage: usageCheck.currentUsage,
              limit: usageCheck.limit,
              workflowId: payload.workflowId,
            },
          )
          throw new Error(
            usageCheck.message ||
              'Usage limit exceeded. Please upgrade your billing tier to continue using workflows.',
          )
        }

        const workflowData =
          payload.executionTarget === 'live'
            ? await loadWorkflowFromNormalizedTables(workflowId)
            : await loadDeployedWorkflowState(workflowId)
        if (!workflowData) {
          throw new Error(
            `Workflow ${workflowId} has no ${payload.executionTarget ?? 'deployed'} state`,
          )
        }

        const { blocks, edges, loops, parallels } = workflowData

        const mergedStates = mergeSubblockState(blocks, {})

        const processedBlockStates = Object.entries(mergedStates).reduce(
          (acc, [blockId, blockState]) => {
            acc[blockId] = Object.entries(blockState.subBlocks).reduce(
              (subAcc, [key, subBlock]) => {
                subAcc[key] = subBlock.value
                return subAcc
              },
              {} as Record<string, any>,
            )
            return acc
          },
          {} as Record<string, Record<string, any>>,
        )

        const wfRows = await db
          .select({ workspaceId: workflowTable.workspaceId })
          .from(workflowTable)
          .where(eq(workflowTable.id, workflowId))
          .limit(1)
        const workspaceId = wfRows[0]?.workspaceId || undefined

        const decryptedEnvVars = await getEffectiveDecryptedEnv(
          payload.userId,
          workspaceId,
        )

        await loggingSession.safeStart({
          userId: payload.userId,
          workspaceId: workspaceId || '',
          variables: decryptedEnvVars,
          triggerData: payload.triggerData,
        })

        const serializer = new Serializer()
        const serializedWorkflow = serializer.serializeWorkflow(
          mergedStates,
          edges,
          loops || {},
          parallels || {},
          true,
        )

        const executor = new Executor({
          workflow: serializedWorkflow,
          currentBlockStates: processedBlockStates,
          envVarValues: decryptedEnvVars,
          workflowInput: payload.input || {},
          workflowVariables: {},
          contextExtensions: {
            executionId,
            workspaceId: workspaceId || '',
            userId: payload.userId,
            concurrencyLeaseInherited: true,
            isDeployedContext: payload.executionTarget !== 'live',
          },
        })

        loggingSession.setupExecutor(executor)

        const startBlockId = payload.startBlockId
        if (startBlockId && !mergedStates[startBlockId]) {
          throw new Error(
            `Workflow ${workflowId} does not contain trigger block ${startBlockId}`,
          )
        }

        if (startBlockId) {
          const outgoingConnections = serializedWorkflow.connections.filter(
            (connection) => connection.source === startBlockId,
          )
          if (outgoingConnections.length === 0) {
            throw new Error(
              `Trigger block ${startBlockId} must be connected to other blocks to execute`,
            )
          }
        }

        const result = await executor.execute(workflowId, startBlockId)
        const executionResult =
          'stream' in result && 'execution' in result
            ? result.execution
            : result

        logger.info(
          `[${requestId}] Workflow execution completed: ${workflowId}`,
          {
            success: executionResult.success,
            executionTime: executionResult.metadata?.duration,
            executionId,
          },
        )

        if (executionResult.success) {
          await updateWorkflowRunCounts(workflowId)
        }

        const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: totalDuration || 0,
          finalOutput: executionResult.output || {},
          traceSpans: traceSpans as any,
        })

        return {
          success: executionResult.success,
          workflowId: payload.workflowId,
          executionId,
          output: executionResult.output,
          executedAt: new Date().toISOString(),
          metadata: payload.metadata,
        }
      },
    })
  } catch (error: any) {
    if (
      isExecutionConcurrencyLimitError(error) ||
      isExecutionConcurrencyBackendUnavailableError(error)
    ) {
      throw error
    }

    logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, {
      error: error.message,
      stack: error.stack,
    })

    const executionResult = error?.executionResult || {
      success: false,
      output: {},
      logs: [],
    }
    const { traceSpans } = buildTraceSpans(executionResult)

    await loggingSession.safeCompleteWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: 0,
      error: {
        message: error.message || 'Workflow execution failed',
        stackTrace: error.stack,
      },
      traceSpans,
    })

    throw error
  }
}
