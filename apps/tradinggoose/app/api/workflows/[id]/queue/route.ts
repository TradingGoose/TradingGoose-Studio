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

type QueuedWorkflowTriggerType = 'api' | 'manual' | 'chat'
type QueuedWorkflowExecutionTarget = 'deployed' | 'live'

type QueueRequestBody = {
  executionId?: string
  input?: unknown
  executionTarget?: unknown
  triggerType?: unknown
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  workflowVariables?: Record<string, unknown>
  startBlockId?: string
  selectedOutputs?: string[]
  workflowDepth?: number
}

function readQueuedWorkflowTriggerType(value: unknown): QueuedWorkflowTriggerType | null {
  if (value === undefined) return 'manual'
  if (value === 'api' || value === 'manual' || value === 'chat') return value
  return null
}

function readQueuedWorkflowExecutionTarget(value: unknown): QueuedWorkflowExecutionTarget | null {
  if (value === undefined) return 'deployed'
  if (value === 'deployed' || value === 'live') return value
  return null
}

function parseQueueRequestBody(value: string): QueueRequestBody | null {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as QueueRequestBody)
      : null
  } catch {
    return null
  }
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

    const body = parseQueueRequestBody(await request.text())
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }
    const executionTarget = readQueuedWorkflowExecutionTarget(body.executionTarget)
    if (!executionTarget) {
      return NextResponse.json(
        { error: 'Unsupported queued workflow execution target' },
        { status: 400 }
      )
    }
    const triggerType = readQueuedWorkflowTriggerType(body.triggerType)
    if (!triggerType) {
      return NextResponse.json(
        { error: 'Unsupported queued workflow trigger type' },
        { status: 400 }
      )
    }
    const childWorkflowExecution = auth.internalWorkflowExecution
    const source = childWorkflowExecution ? 'workflow_block' : 'workflow_queue'

    if (executionTarget === 'deployed' && !accessContext.workflow.isDeployed) {
      return NextResponse.json({ error: 'Workflow is not deployed' }, { status: 403 })
    }

    if (
      !accessContext.isOwner &&
      !accessContext.isWorkspaceOwner &&
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
