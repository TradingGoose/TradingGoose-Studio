import { v4 as uuidv4 } from 'uuid'
import { isPendingWorkflowExecutionCancellationRequested } from '@/lib/execution/pending-execution'
import { createWorkflowExecutionEventWriter } from '@/lib/execution/workflow-execution-events'
import {
  isWorkflowExecutionTimePolicy,
  type WorkflowExecutionTimePolicy,
} from '@/lib/execution/workflow-execution-time-policy'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getMonitorProviderForTriggerId, isMonitorTriggerId } from '@/lib/monitors/sources'
import { createWorkflowExecutionTerminalEventInput } from '@/lib/workflows/execution-events'
import {
  runPreparedWorkflowExecution,
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

export type WorkflowExecutionAttemptOptions = {
  attemptStartedAt: string
  timePolicy: WorkflowExecutionTimePolicy
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

export async function executeWorkflowJob(
  payload: WorkflowExecutionPayload,
  options: WorkflowExecutionAttemptOptions & { blueprint?: WorkflowExecutionBlueprint }
) {
  const workflowId = payload.workflowId
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)
  const isChildExecution = payload.metadata?.source === 'workflow_block'
  const eventWriter =
    payload.stream === true || isChildExecution
      ? await createWorkflowExecutionEventWriter({
          pendingExecutionId: executionId,
          workflowId,
        })
      : null
  const executionTarget = payload.executionTarget ?? 'deployed'
  const isLiveExecution = executionTarget === 'live'
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

  const processingStartedAt = options.attemptStartedAt
  const inheritedPolicy = isChildExecution ? payload.metadata?.timePolicy : undefined
  if (isChildExecution && !isWorkflowExecutionTimePolicy(inheritedPolicy)) {
    throw new Error('Nested workflow execution is missing its authenticated time policy')
  }
  if (!isWorkflowExecutionTimePolicy(options.timePolicy)) {
    throw new Error('Workflow execution is missing its captured time policy')
  }
  const timePolicy = isChildExecution ? inheritedPolicy! : options.timePolicy

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

  try {
    const triggerData =
      payload.metadata === undefined
        ? payload.triggerData
        : { ...(payload.triggerData ?? {}), queuedExecution: payload.metadata }
    const runner = options?.blueprint
      ? runPreparedWorkflowExecution({
          blueprint: options.blueprint,
          actorUserId: payload.userId,
          requestId,
          executionId,
          triggerType,
          workflowInput: payload.input ?? {},
          triggerTarget,
          triggerData,
          timePolicy,
          attemptStartedAt: processingStartedAt,
          contextExtensions: {
            workflowDepth: payload.workflowDepth ?? 0,
            isChildExecution,
            stream: payload.stream === true,
            selectedOutputs: payload.selectedOutputs ?? [],
            shouldCancelExecution: () =>
              isPendingWorkflowExecutionCancellationRequested(executionId),
          },
        })
      : runWorkflowExecution({
          workflowId,
          actorUserId: payload.userId,
          requestId,
          executionId,
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
          timePolicy,
          attemptStartedAt: processingStartedAt,
          contextExtensions: {
            workflowDepth: payload.workflowDepth ?? 0,
            isChildExecution,
            stream: payload.stream === true,
            selectedOutputs: payload.selectedOutputs ?? [],
            shouldCancelExecution: () =>
              isPendingWorkflowExecutionCancellationRequested(executionId),
            ...(payload.stream === true && eventWriter
              ? {
                  onExecutionEvent: async (event) => {
                    await eventWriter.write(event)
                  },
                }
              : {}),
          },
        })
    const { result, dispatchFailureReason } = await runner
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

    await eventWriter?.write(createWorkflowExecutionTerminalEventInput(queuedResult))

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
      executionId,
    })

    return queuedResult
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow execution failed'
    await eventWriter?.write(
      createWorkflowExecutionTerminalEventInput({
        success: false,
        output: {},
        error: message,
        logs: [],
      })
    )
    throw error
  }
}
