import { type NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { generateRequestId } from '@/lib/utils'
import { getWorkflowAccessContext } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowQueueAPI')

type QueueRequestBody = {
  input?: Record<string, unknown>
  executionTarget?: 'deployed' | 'live'
  triggerType?: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  workflowDepth?: number
  parentWorkflowId?: string
  parentExecutionId?: string
  parentBlockId?: string
}

const hasReadAccess = (
  accessContext: Awaited<ReturnType<typeof getWorkflowAccessContext>>,
) =>
  Boolean(
    accessContext &&
      (accessContext.isOwner || accessContext.workspacePermission !== null),
  )

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id: workflowId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, {
      requireWorkflowId: false,
    })

    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const accessContext = await getWorkflowAccessContext(workflowId, auth.userId)
    if (!accessContext?.workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (!hasReadAccess(accessContext)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = ((await request.json().catch(() => ({}))) || {}) as QueueRequestBody
    const executionTarget = body.executionTarget === 'live' ? 'live' : 'deployed'
    const triggerType = body.triggerType ?? 'manual'

    if (executionTarget === 'deployed' && !accessContext.workflow.isDeployed) {
      return NextResponse.json(
        { error: 'Workflow is not deployed' },
        { status: 403 }
      )
    }

    const source = body.parentBlockId ? 'workflow_block' : 'workflow_queue'
    const createdAt = new Date().toISOString()
    const pendingExecutionId = `workflow_execution_${randomUUID()}`
    const handle = await enqueuePendingExecution({
      executionType: 'workflow',
      pendingExecutionId,
      workflowId,
      workspaceId: accessContext.workflow.workspaceId,
      userId: auth.userId,
      source,
      requestId,
      payload: {
        executionId: pendingExecutionId,
        workflowId,
        userId: auth.userId,
        input: body.input ?? {},
        triggerType,
        executionTarget,
        workflowDepth:
          typeof body.workflowDepth === 'number' ? body.workflowDepth : 0,
        metadata: {
          source,
          parentWorkflowId: body.parentWorkflowId ?? null,
          parentExecutionId: body.parentExecutionId ?? null,
          parentBlockId: body.parentBlockId ?? null,
        },
      },
    })

    return NextResponse.json(
      {
        success: true,
        taskId: handle.pendingExecutionId,
        workflowName: accessContext.workflow.name,
        status: 'queued',
        createdAt,
        links: {
          status: `/api/jobs/${handle.pendingExecutionId}`,
        },
      },
      { status: 202 }
    )
  } catch (error) {
    if (isPendingExecutionLimitError(error)) {
      return NextResponse.json(
        { error: 'Pending execution backlog is full' },
        { status: error.statusCode }
      )
    }

    if (error instanceof TriggerExecutionUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    logger.error(`[${requestId}] Failed to queue workflow execution`, {
      workflowId,
      error,
    })

    return NextResponse.json({ error: 'Failed to queue workflow execution' }, { status: 500 })
  }
}
