import { v4 as uuidv4 } from 'uuid'
import { createWorkflowExecutionEventWriter } from '@/lib/execution/workflow-execution-events'
import { isPendingWorkflowExecutionCancellationRequested } from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  runWorkflowExecution,
  type WorkflowExecutionBlueprint,
  type WorkflowStart,
} from '@/lib/workflows/execution-runner'
import type { TriggerType } from '@/services/queue'

const logger = createLogger('TriggerWorkflowExecution')

type WorkflowStartTriggerType = Extract<WorkflowStart, { kind: 'trigger' }>['triggerType']

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  workspaceId?: string | null
  executionId?: string
  input?: any
  triggerType?: TriggerType
  startBlockId?: string
  executionTarget?: 'deployed' | 'live'
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  workflowVariables?: Record<string, unknown>
  workflowDepth?: number
  stream?: boolean
  selectedOutputs?: string[]
  triggerData?: Record<string, unknown>
  metadata?: Record<string, any>
}

function resolveWorkflowStartTriggerType(triggerType: TriggerType): WorkflowStartTriggerType {
  if (triggerType === 'chat') return 'chat'
  if (triggerType === 'api' || triggerType === 'api-endpoint') return 'api'
  if (triggerType === 'manual') return 'manual'
  throw new Error(`Queued ${triggerType} workflow execution requires an explicit start block`)
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
  const eventWriter = await createWorkflowExecutionEventWriter({
    pendingExecutionId: executionId,
    workflowId,
    enabled: payload.stream === true,
  })
  const isChildExecution = payload.metadata?.source === 'workflow_block'
  const triggerType = payload.triggerType ?? 'manual'
  const start: WorkflowStart = payload.startBlockId
    ? {
        kind: 'block',
        blockId: payload.startBlockId,
      }
    : {
        kind: 'trigger',
        triggerType: resolveWorkflowStartTriggerType(triggerType),
      }

  logger.info(`[${requestId}] Starting workflow execution: ${workflowId}`, {
    userId: payload.userId,
    triggerType,
    executionId,
  })

  await eventWriter.write({
    type: 'execution:started',
    data: {
      startTime: new Date().toISOString(),
    },
  })

  try {
    const { result } = await runWorkflowExecution({
      workflowId,
      actorUserId: payload.userId,
      requestId,
      executionId,
      executionTarget: payload.executionTarget ?? 'deployed',
      triggerType,
      workflowInput: payload.input ?? {},
      workflowContext:
        payload.workspaceId || payload.workflowVariables
          ? {
              workspaceId: payload.workspaceId,
              variables: payload.workflowVariables,
            }
          : undefined,
      workflowData: payload.workflowData,
      start,
      triggerData: payload.triggerData,
      contextExtensions: {
        workflowDepth: payload.workflowDepth ?? 0,
        isChildExecution,
        stream: payload.stream === true,
        selectedOutputs: payload.selectedOutputs ?? [],
        shouldCancelExecution: () => isPendingWorkflowExecutionCancellationRequested(executionId),
        onExecutionEvent: async (event) => {
          await eventWriter.write(event)
        },
      },
    })

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

    if (result.success) {
      await eventWriter.write({
        type: 'execution:completed',
        data: { result: queuedResult },
      })
    } else if (result.error === 'Workflow execution was cancelled') {
      await eventWriter.write({
        type: 'execution:cancelled',
        data: { result: queuedResult },
      })
    } else {
      await eventWriter.write({
        type: 'execution:error',
        data: {
          error: result.error || 'Workflow execution failed',
          result: queuedResult,
        },
      })
    }

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
      executionId,
    })

    return queuedResult
  } catch (error) {
    await eventWriter.write({
      type: 'execution:error',
      data: {
        error: error instanceof Error ? error.message : 'Workflow execution failed',
      },
    })
    throw error
  }
}
