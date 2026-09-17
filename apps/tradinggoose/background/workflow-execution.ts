import { v4 as uuidv4 } from 'uuid'
import { isPendingWorkflowExecutionCancellationRequested } from '@/lib/execution/pending-execution'
import { createWorkflowExecutionEventWriter } from '@/lib/execution/workflow-execution-events'
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
import { claimWorkflowCheckpoint } from '@/lib/workflows/human-in-the-loop/service'
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
  resumeExecutionId?: string
  checkpointRevision?: number
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
  const jobId = payload.executionId ?? uuidv4()
  const resumed =
    payload.resumeExecutionId && payload.checkpointRevision
      ? await claimWorkflowCheckpoint({
          executionId: payload.resumeExecutionId,
          revision: payload.checkpointRevision,
          jobId,
        })
      : null
  if (payload.resumeExecutionId && !resumed)
    return { success: true, skipped: 'checkpoint_already_claimed' }
  if (resumed && (resumed.workflowId !== workflowId || resumed.userId !== payload.userId)) {
    throw new Error('Resume execution scope does not match its checkpoint')
  }
  const executionId = resumed?.executionId ?? jobId
  const requestId = executionId.slice(0, 8)
  const savedContext = resumed?.snapshot.executor.context
  const eventWriter =
    payload.stream === true || savedContext?.stream === true
      ? await createWorkflowExecutionEventWriter({
          pendingExecutionId: executionId,
          workflowId,
        })
      : null
  const executionTarget =
    resumed?.snapshot.blueprint.executionTarget ?? payload.executionTarget ?? 'deployed'
  const isLiveExecution = executionTarget === 'live'
  const isChildExecution =
    payload.metadata?.source === 'workflow_block' || (savedContext?.workflowDepth ?? 0) > 0
  const triggerType = resumed?.snapshot.triggerType ?? payload.triggerType ?? 'manual'
  const triggerBlockId = savedContext?.triggerBlockId ?? payload.triggerBlockId
  const triggerTarget: WorkflowTriggerTarget = triggerBlockId
    ? {
        kind: 'block',
        blockId: triggerBlockId,
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

  try {
    const triggerData =
      resumed?.snapshot.triggerData ??
      (payload.metadata === undefined
        ? payload.triggerData
        : { ...(payload.triggerData ?? {}), queuedExecution: payload.metadata })
    const runParams = {
      workflowId,
      actorUserId: payload.userId,
      requestId,
      executionId,
      executionTarget,
      triggerType,
      workflowInput: resumed?.snapshot.workflowInput ?? payload.input ?? {},
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
        pendingExecutionId: jobId,
        workflowDepth: payload.workflowDepth ?? 0,
        isChildExecution,
        stream: payload.stream === true || savedContext?.stream === true,
        selectedOutputs: savedContext?.selectedOutputs ?? payload.selectedOutputs ?? [],
        shouldCancelExecution: () => isPendingWorkflowExecutionCancellationRequested(jobId),
        ...(eventWriter
          ? {
              onExecutionEvent: async (event: Parameters<typeof eventWriter.write>[0]) => {
                await eventWriter.write(event)
              },
            }
          : {}),
      },
    }
    const { result, dispatchFailureReason } = resumed
      ? await runPreparedWorkflowExecution({
          ...runParams,
          blueprint: resumed.snapshot.blueprint,
          resume: resumed,
        })
      : await runWorkflowExecution(runParams)
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

    if (result.status !== 'paused')
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
