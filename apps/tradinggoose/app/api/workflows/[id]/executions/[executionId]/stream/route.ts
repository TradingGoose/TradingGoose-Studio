import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  readWorkflowExecutionAccessContext,
  type WorkflowExecutionAccessContext,
} from '@/lib/execution/workflow-execution-events'
import { openWorkflowExecutionEventStream } from '@/lib/execution/workflow-execution-stream'
import { createLogger } from '@/lib/logs/console/logger'
import { SSE_HEADERS } from '@/lib/utils'
import { readWorkflowAccessContext, type WorkflowAccessContext } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowExecutionStreamAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseFromEventId(request: NextRequest) {
  const value = request.nextUrl.searchParams.get('from')
  if (!value) return 0
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

function canReadWorkflowExecution(params: {
  accessContext: WorkflowAccessContext
  execution: WorkflowExecutionAccessContext
  userId: string
}) {
  if (params.execution.userId === params.userId) return true
  if (!params.execution.workspaceId) return false
  if (params.execution.workspaceId !== params.accessContext.workflow.workspaceId) return false
  return (
    params.accessContext.isOwner ||
    params.accessContext.isWorkspaceOwner ||
    params.accessContext.workspacePermission !== null
  )
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

    const executionAccess = await readWorkflowExecutionAccessContext({
      pendingExecutionId: executionId,
      workflowId,
    })
    if (!executionAccess) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    const accessContext = await readWorkflowAccessContext(workflowId, auth.userId)
    if (!accessContext?.workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (
      !canReadWorkflowExecution({ accessContext, execution: executionAccess, userId: auth.userId })
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
