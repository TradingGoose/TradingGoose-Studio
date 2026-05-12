import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  readPendingWorkflowExecutionAccessContext,
  type PendingWorkflowExecutionAccessContext,
} from '@/lib/execution/pending-execution'
import { openWorkflowExecutionEventStream } from '@/lib/execution/workflow-execution-stream'
import { createLogger } from '@/lib/logs/console/logger'
import { SSE_HEADERS } from '@/lib/utils'
import {
  readWorkflowAccessContext,
  type WorkflowAccessContext,
} from '@/lib/workflows/utils'

const logger = createLogger('WorkflowExecutionStreamAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function canReadPendingWorkflowExecution(params: {
  accessContext: WorkflowAccessContext
  pendingExecution: PendingWorkflowExecutionAccessContext
  userId: string
}) {
  if (params.pendingExecution.userId === params.userId) return true
  if (!params.pendingExecution.workspaceId) return false
  if (params.pendingExecution.workspaceId !== params.accessContext.workflow.workspaceId) {
    return false
  }
  return (
    params.accessContext.isOwner ||
    params.accessContext.isWorkspaceOwner ||
    params.accessContext.workspacePermission !== null
  )
}

function parseFromEventId(request: NextRequest) {
  const value = request.nextUrl.searchParams.get('from')
  if (!value) return 0
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  const { id: workflowId, executionId } = await params
  const fromEventId = parseFromEventId(request)

  try {
    const auth = await checkSessionOrInternalAuth(request, {
      requireWorkflowId: false,
    })

    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const pendingExecution = await readPendingWorkflowExecutionAccessContext({
      pendingExecutionId: executionId,
      workflowId,
    })
    if (!pendingExecution) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    const accessContext = await readWorkflowAccessContext(workflowId, auth.userId)
    if (!accessContext?.workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (
      !canReadPendingWorkflowExecution({
        accessContext,
        pendingExecution,
        userId: auth.userId,
      })
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const streamResult = await openWorkflowExecutionEventStream({
      pendingExecutionId: executionId,
      workflowId,
      fromEventId,
    })

    if (!streamResult.ok) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    return new NextResponse(streamResult.stream, {
      headers: {
        ...SSE_HEADERS,
        'X-Execution-Id': executionId,
      },
    })
  } catch (error) {
    logger.error('Failed to open workflow execution stream', {
      workflowId,
      executionId,
      error,
    })
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to open workflow execution stream',
      },
      { status: 500 }
    )
  }
}
