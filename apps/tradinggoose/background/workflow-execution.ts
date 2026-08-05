import { v4 as uuidv4 } from 'uuid'
import { isPendingWorkflowExecutionCancellationRequested } from '@/lib/execution/pending-execution'
import { createWorkflowExecutionEventWriter } from '@/lib/execution/workflow-execution-events'
import {
  completeWorkflowExecutionAttempt,
  finalizeWorkflowExecution,
  type WorkflowExecutionLifecycle,
} from '@/lib/execution/workflow-execution-lifecycle-repository'
import { createWorkflowExecutionRuntime } from '@/lib/execution/workflow-execution-runtime'
import { isWorkflowExecutionTimePolicy } from '@/lib/execution/workflow-execution-time-policy'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getMonitorProviderForTriggerId, isMonitorTriggerId } from '@/lib/monitors/sources'
import {
  runWorkflowExecution,
  type WorkflowExecutionBlueprint,
  type WorkflowTriggerTarget,
} from '@/lib/workflows/execution-runner'
import type { ExecutionResult } from '@/executor/types'
import type { TriggerType } from '@/services/queue'
import { disableMonitor } from './monitor-disable'

const logger = createLogger('TriggerWorkflowExecution')

type WorkflowTriggerTargetType = Extract<WorkflowTriggerTarget, { kind: 'trigger' }>['triggerType']

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  workspaceId?: string | null
  executionId?: string
  drainRunId?: string
  workflowExecutionLifecycle?: WorkflowExecutionLifecycle
  input?: any
  triggerType?: TriggerType
  triggerBlockId?: string
  executionTarget?: 'deployed' | 'live'
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  workflowVariables?: Record<string, unknown>
  workflowDepth?: number
  stream?: boolean
  selectedOutputs?: string[]
  triggerData?: Record<string, unknown>
  metadata?: Record<string, any>
  adapter?: WorkflowExecutionAdapter
}

export type WorkflowExecutionAdapter = {
  prepare?: (context: {
    executionId: string
    requestId: string
    signal?: AbortSignal
  }) => Promise<
    | Partial<Omit<WorkflowExecutionPayload, 'adapter' | 'workflowExecutionLifecycle'>>
    | { skipResult: ExecutionResult }
  >
  complete?: (context: {
    executionId: string
    requestId: string
    result: Awaited<ReturnType<typeof runWorkflowExecution>>['result']
    signal?: AbortSignal
  }) => Promise<void>
  error?: (context: {
    executionId: string
    requestId: string
    error: unknown
    signal?: AbortSignal
  }) => Promise<boolean | undefined>
}

function resolveWorkflowTriggerTargetType(triggerType: TriggerType): WorkflowTriggerTargetType {
  if (triggerType === 'chat') return 'chat'
  if (triggerType === 'api' || triggerType === 'api-endpoint') return 'api'
  if (triggerType === 'manual') return 'manual'
  throw new Error(`Queued ${triggerType} workflow execution requires an explicit trigger block`)
}

export function isWorkflowExecutionPayload(
  value: unknown
): value is WorkflowExecutionPayload & Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.workflowId === 'string' && typeof candidate.userId === 'string'
}

export async function executeWorkflowJob(payload: WorkflowExecutionPayload) {
  const workflowId = payload.workflowId
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)
  if (!payload.workflowExecutionLifecycle) {
    throw new Error(`Workflow execution ${executionId} is missing its claimed lifecycle`)
  }
  const deadlineRuntime = createWorkflowExecutionRuntime(
    payload.workflowExecutionLifecycle,
    (error) => logger.error(`[${requestId}] Workflow deadline heartbeat failed`, error)
  )
  let effectivePayload = payload
  let runnerInvoked = false
  let authoritativeResult: ExecutionResult | null | undefined
  try {
    await deadlineRuntime.start()
    deadlineRuntime.signal?.throwIfAborted()
    if (payload.adapter?.prepare) {
      const preparation = await payload.adapter.prepare({
        executionId,
        requestId,
        signal: deadlineRuntime.signal,
      })
      deadlineRuntime.signal?.throwIfAborted()
      if ('skipResult' in preparation) {
        await deadlineRuntime.settleStartup('completed')
        if (payload.workflowExecutionLifecycle.isRoot) {
          authoritativeResult = await finalizeWorkflowExecution({
            rootExecutionId: payload.workflowExecutionLifecycle.policy.rootExecutionId,
            attemptId: payload.workflowExecutionLifecycle.attemptId,
            result: preparation.skipResult,
          })
        } else {
          await completeWorkflowExecutionAttempt({
            attemptId: payload.workflowExecutionLifecycle.attemptId,
            result: preparation.skipResult,
          })
          authoritativeResult = preparation.skipResult
        }
        if (!authoritativeResult) {
          throw new Error(`Workflow execution ${executionId} terminal reconciliation is pending`)
        }
        await payload.adapter.complete?.({
          executionId,
          requestId,
          result: authoritativeResult,
          signal: deadlineRuntime.signal,
        })
        return {
          ...authoritativeResult,
          workflowId,
          executionId,
          traceSpans: [],
          executedAt: new Date().toISOString(),
          metadata: {
            ...(authoritativeResult.metadata ?? {}),
            queuedExecution: payload.metadata,
          },
        }
      }
      effectivePayload = { ...payload, ...preparation }
    }
    const eventWriter =
      effectivePayload.stream === true
        ? await createWorkflowExecutionEventWriter({
            pendingExecutionId: executionId,
            workflowId,
          })
        : null
    deadlineRuntime.signal?.throwIfAborted()
    const executionTarget = effectivePayload.executionTarget ?? 'deployed'
    const isLiveExecution = executionTarget === 'live'
    const isChildExecution = effectivePayload.metadata?.source === 'workflow_block'
    const triggerType = effectivePayload.triggerType ?? 'manual'
    const triggerTarget: WorkflowTriggerTarget = effectivePayload.triggerBlockId
      ? {
          kind: 'block',
          blockId: effectivePayload.triggerBlockId,
        }
      : {
          kind: 'trigger',
          triggerType: resolveWorkflowTriggerTargetType(triggerType),
        }

    logger.info(`[${requestId}] Starting workflow execution: ${workflowId}`, {
      userId: effectivePayload.userId,
      triggerType,
      executionId,
    })

    await eventWriter?.write({
      type: 'execution:started',
      data: {
        startTime: new Date().toISOString(),
      },
    })
    deadlineRuntime.signal?.throwIfAborted()

    const triggerData =
      effectivePayload.metadata === undefined
        ? effectivePayload.triggerData
        : {
            ...(effectivePayload.triggerData ?? {}),
            queuedExecution: effectivePayload.metadata,
          }
    runnerInvoked = true
    const { result, dispatchFailureReason } = await runWorkflowExecution({
      workflowId,
      actorUserId: effectivePayload.userId,
      requestId,
      executionId,
      lifecycle: payload.workflowExecutionLifecycle,
      deadlineRuntime,
      executionTarget,
      triggerType,
      workflowInput: effectivePayload.input ?? {},
      workflowContext:
        effectivePayload.workspaceId || (isLiveExecution && effectivePayload.workflowVariables)
          ? {
              workspaceId: effectivePayload.workspaceId,
              variables: isLiveExecution ? effectivePayload.workflowVariables : undefined,
            }
          : undefined,
      workflowData: isLiveExecution ? effectivePayload.workflowData : undefined,
      triggerTarget,
      triggerData,
      contextExtensions: {
        workflowDepth: effectivePayload.workflowDepth ?? 0,
        isChildExecution,
        stream: effectivePayload.stream === true,
        selectedOutputs: effectivePayload.selectedOutputs ?? [],
        workflowExecutionTimePolicy: isWorkflowExecutionTimePolicy(
          effectivePayload.metadata?.workflowExecutionTimePolicy
        )
          ? effectivePayload.metadata.workflowExecutionTimePolicy
          : undefined,
        shouldCancelExecution: () => isPendingWorkflowExecutionCancellationRequested(executionId),
        ...(eventWriter
          ? {
              onExecutionEvent: async (event) => {
                await eventWriter.write(event)
              },
            }
          : {}),
      },
    })
    authoritativeResult = result
    await effectivePayload.adapter?.complete?.({
      executionId,
      requestId,
      result,
      signal: deadlineRuntime.signal,
    })
    if (dispatchFailureReason && isMonitorTriggerId(triggerData?.source)) {
      const monitorId = (triggerData.monitor as { id?: unknown } | null | undefined)?.id
      if (typeof monitorId === 'string') {
        await disableMonitor({
          monitorId,
          provider: getMonitorProviderForTriggerId(triggerData.source),
          logger,
          reason: dispatchFailureReason,
          workflowId,
        })
      }
    }

    const { traceSpans } = buildTraceSpans(result)
    const queuedResult = {
      ...result,
      success: result.success,
      workflowId: effectivePayload.workflowId,
      executionId,
      output: result.output,
      error: result.error,
      traceSpans: traceSpans || [],
      executedAt: new Date().toISOString(),
      metadata: {
        ...(result.metadata ?? {}),
        queuedExecution: effectivePayload.metadata,
      },
    }

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
      executionId,
    })

    return queuedResult
  } catch (error) {
    if (authoritativeResult) throw error
    const errorHandled = await effectivePayload.adapter?.error?.({
      executionId,
      requestId,
      error,
      signal: deadlineRuntime.signal,
    })
    const deadlineAborted = deadlineRuntime.signal?.aborted === true
    await deadlineRuntime.settleStartup(deadlineAborted ? 'local_abort' : 'failed')
    if (!runnerInvoked) {
      const proposedResult = {
        success: false,
        output: {},
        error: error instanceof Error ? error.message : String(error),
      }
      if (effectivePayload.workflowExecutionLifecycle!.isRoot) {
        authoritativeResult = await finalizeWorkflowExecution({
          rootExecutionId: effectivePayload.workflowExecutionLifecycle!.policy.rootExecutionId,
          attemptId: effectivePayload.workflowExecutionLifecycle!.attemptId,
          result: proposedResult,
        })
      } else {
        await completeWorkflowExecutionAttempt({
          attemptId: effectivePayload.workflowExecutionLifecycle!.attemptId,
          result: proposedResult,
        })
        authoritativeResult = proposedResult
      }
    }
    if (errorHandled) {
      if (!authoritativeResult) throw error
      return {
        ...authoritativeResult,
        workflowId: effectivePayload.workflowId,
        executionId,
        traceSpans: [],
        executedAt: new Date().toISOString(),
        metadata: {
          ...(authoritativeResult.metadata ?? {}),
          queuedExecution: effectivePayload.metadata,
        },
      }
    }
    throw error
  } finally {
    deadlineRuntime.close()
  }
}
