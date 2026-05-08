import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { generateRequestId } from '@/lib/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowLogAPI')

export const dynamic = 'force-dynamic'

type WorkflowLogTriggerType = 'manual' | 'chat' | 'api'

const WORKFLOW_LOG_TRIGGER_TYPES = new Set<WorkflowLogTriggerType>(['manual', 'chat', 'api'])

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isWorkflowLogTriggerType(value: string): value is WorkflowLogTriggerType {
  return WORKFLOW_LOG_TRIGGER_TYPES.has(value as WorkflowLogTriggerType)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json()
    const phase = readNonEmptyString(body.phase)
    const executionId = readNonEmptyString(body.executionId)
    const triggerType = readNonEmptyString(body.triggerType)

    if (phase !== 'start' && phase !== 'complete') {
      return createErrorResponse('Invalid workflow log phase', 400)
    }

    if (!executionId) {
      return createErrorResponse('Execution id is required', 400)
    }

    if (!triggerType || !isWorkflowLogTriggerType(triggerType)) {
      return createErrorResponse('Invalid workflow log trigger type', 400)
    }

    const session = await getSession()
    const userId = session?.user?.id ?? validation.workflow.userId
    const workspaceId = validation.workflow.workspaceId

    if (!workspaceId) {
      return createErrorResponse('Workflow is missing workspace scope', 400)
    }

    const loggingSession = new LoggingSession(id, executionId, triggerType, requestId)

    if (phase === 'start') {
      logger.info(`[${requestId}] Starting execution log for workflow: ${id}`, {
        executionId,
        triggerType,
      })

      const workflowLogId = await loggingSession.start({
        userId,
        workspaceId,
        variables: {},
      })

      return createSuccessResponse({ workflowLogId })
    }

    const { result } = body
    const workflowLogId = readNonEmptyString(body.workflowLogId)

    if (!workflowLogId) {
      return createErrorResponse('Workflow log id is required', 400)
    }

    if (!result) {
      return createErrorResponse('Execution result is required', 400)
    }

    logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
      executionId,
      success: result.success,
    })

    const { traceSpans, totalDuration } = buildTraceSpans(result)
    const completionScope = { workspaceId, actorUserId: userId ?? null }
    const totalDurationMs = totalDuration || result.metadata?.duration || 0

    if (result.success === false) {
      await loggingSession.completeWithError({
        ...completionScope,
        endedAt: new Date().toISOString(),
        totalDurationMs,
        error: { message: result.error || 'Workflow execution failed' },
        traceSpans,
      })
    } else {
      await loggingSession.complete({
        ...completionScope,
        endedAt: new Date().toISOString(),
        totalDurationMs,
        finalOutput: result.output === undefined ? {} : result.output,
        traceSpans,
      })
    }

    return createSuccessResponse({ workflowLogId })
  } catch (error: any) {
    logger.error(`[${requestId}] Error persisting logs for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to persist logs', 500)
  }
}
