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
  try {
    await deadlineRuntime.start()
    deadlineRuntime.signal?.throwIfAborted()
    const eventWriter =
      payload.stream === true
        ? await createWorkflowExecutionEventWriter({
            pendingExecutionId: executionId,
            workflowId,
          })
        : null
    deadlineRuntime.signal?.throwIfAborted()
    const executionTarget = payload.executionTarget ?? 'deployed'
    const isLiveExecution = executionTarget === 'live'
    const isChildExecution = payload.metadata?.source === 'workflow_block'
    const triggerType = payload.triggerType ?? 'manual'
    const triggerTarget: WorkflowTriggerTarget = payload.triggerBlockId
      ? {
          kind: 'block',
          blockId: payload.triggerBlockId,
        }
      : {
          kind: 'trigger',
          triggerType: resolveWorkflowTriggerTargetType(triggerType),
        }

    logger.info(`[${requestId}] Starting workflow execution: ${workflowId}`, {
      userId: payload.userId,
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
      payload.metadata === undefined
        ? payload.triggerData
        : { ...(payload.triggerData ?? {}), queuedExecution: payload.metadata }
    const { result, dispatchFailureReason } = await runWorkflowExecution({
      workflowId,
      actorUserId: payload.userId,
      requestId,
      executionId,
      lifecycle: payload.workflowExecutionLifecycle,
      deadlineRuntime,
      executionTarget,
      triggerType,
      workflowInput: payload.input ?? {},
      workflowContext:
        payload.workspaceId || (isLiveExecution && payload.workflowVariables)
          ? {
              workspaceId: payload.workspaceId,
              variables: isLiveExecution ? payload.workflowVariables : undefined,
            }
          : undefined,
      workflowData: isLiveExecution ? payload.workflowData : undefined,
      triggerTarget,
      triggerData,
      contextExtensions: {
        workflowDepth: payload.workflowDepth ?? 0,
        isChildExecution,
        stream: payload.stream === true,
        selectedOutputs: payload.selectedOutputs ?? [],
        workflowExecutionTimePolicy: isWorkflowExecutionTimePolicy(
          payload.metadata?.workflowExecutionTimePolicy
        )
          ? payload.metadata.workflowExecutionTimePolicy
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
    deadlineRuntime.signal?.throwIfAborted()
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
      workflowId: payload.workflowId,
      executionId,
      output: result.output,
      error: result.error,
      traceSpans: traceSpans || [],
      executedAt: new Date().toISOString(),
      metadata: {
        ...(result.metadata ?? {}),
        queuedExecution: payload.metadata,
      },
    }

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
      executionId,
    })

    return queuedResult
  } catch (error) {
    const deadlineAborted = deadlineRuntime.signal?.aborted === true
    await deadlineRuntime.settleStartup(deadlineAborted ? 'local_abort' : 'failed')
    if (deadlineAborted) {
      const result = {
        success: false,
        output: {},
        error: error instanceof Error ? error.message : String(error),
      }
      if (payload.workflowExecutionLifecycle.isRoot) {
        await finalizeWorkflowExecution({
          rootExecutionId: payload.workflowExecutionLifecycle.policy.rootExecutionId,
          attemptId: payload.workflowExecutionLifecycle.attemptId,
          result,
        })
      } else {
        await completeWorkflowExecutionAttempt({
          attemptId: payload.workflowExecutionLifecycle.attemptId,
          result,
        })
      }
    }
    throw error
  } finally {
    deadlineRuntime.close()
  }
}
