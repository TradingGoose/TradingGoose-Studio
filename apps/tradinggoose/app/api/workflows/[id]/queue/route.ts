import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { generateRequestId } from '@/lib/utils'
import type { WorkflowExecutionBlueprint } from '@/lib/workflows/execution-runner'
import { readWorkflowAccessContext } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowQueueAPI')

type QueueRequestBody = {
  executionId?: string
  input?: unknown
  executionTarget?: 'deployed' | 'live'
  triggerType?: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  workflowVariables?: Record<string, unknown>
  startBlockId?: string
  selectedOutputs?: string[]
  workflowDepth?: number
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id: workflowId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, {
      requireWorkflowId: false,
    })

    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const accessContext = await readWorkflowAccessContext(workflowId, auth.userId)
    if (!accessContext?.workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (!accessContext.isOwner && accessContext.workspacePermission === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = ((await request.json().catch(() => ({}))) || {}) as QueueRequestBody
    const executionTarget = body.executionTarget === 'live' ? 'live' : 'deployed'
    const triggerType = body.triggerType ?? 'manual'
    const childWorkflowExecution = auth.internalWorkflowExecution
    const source = childWorkflowExecution ? 'workflow_block' : 'workflow_queue'

    if (executionTarget === 'deployed' && !accessContext.workflow.isDeployed) {
      return NextResponse.json({ error: 'Workflow is not deployed' }, { status: 403 })
    }

    if (
      source === 'workflow_queue' &&
      !accessContext.isOwner &&
      accessContext.workspacePermission !== 'write' &&
      accessContext.workspacePermission !== 'admin'
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const createdAt = new Date().toISOString()
    const pendingExecutionId =
      typeof body.executionId === 'string' && body.executionId.length > 0
        ? body.executionId
        : `workflow_execution_${randomUUID()}`
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
        workspaceId: accessContext.workflow.workspaceId,
        workflowData: body.workflowData,
        workflowVariables: body.workflowVariables,
        selectedOutputs: body.selectedOutputs,
        startBlockId:
          typeof body.startBlockId === 'string' && body.startBlockId.length > 0
            ? body.startBlockId
            : undefined,
        workflowDepth: typeof body.workflowDepth === 'number' ? body.workflowDepth : 0,
        metadata: {
          source,
          parentWorkflowId: childWorkflowExecution?.parentWorkflowId ?? null,
          parentExecutionId: childWorkflowExecution?.parentExecutionId ?? null,
          parentBlockId: childWorkflowExecution?.parentBlockId ?? null,
        },
      },
    })

    return NextResponse.json(
      {
        success: true,
        taskId: handle.pendingExecutionId,
        executionId: pendingExecutionId,
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
