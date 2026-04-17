import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { runWorkflowExecution } from '@/lib/workflows/execution-runner'

const logger = createLogger('TriggerWorkflowExecution')

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  executionId?: string
  input?: any
  triggerType?: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  startBlockId?: string
  executionTarget?: 'deployed' | 'live'
  workflowDepth?: number
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

  const { result } = await runWorkflowExecution({
    workflowId,
    actorUserId: payload.userId,
    requestId,
    executionId,
    executionTarget: payload.executionTarget ?? 'deployed',
    triggerType: payload.triggerType ?? 'api',
    workflowInput: payload.input ?? {},
    start: {
      kind: 'block',
      blockId: payload.startBlockId,
    },
    triggerData: payload.triggerData,
    contextExtensions: {
      workflowDepth: payload.workflowDepth ?? 0,
    },
  })

  const { traceSpans } = buildTraceSpans(result)

  logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
    success: result.success,
    executionTime: result.metadata?.duration,
    executionId,
  })

  return {
    success: result.success,
    workflowId: payload.workflowId,
    executionId,
    output: result.output,
    error: result.error,
    traceSpans: traceSpans || [],
    executedAt: new Date().toISOString(),
    metadata: payload.metadata,
  }
}
