import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { openWorkflowExecutionEventStream } from '@/lib/execution/workflow-execution-stream'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { generateRequestId, SSE_HEADERS } from '@/lib/utils'
import type { WorkflowExecutionBlueprint } from '@/lib/workflows/execution-runner'
import { readWorkflowAccessContext } from '@/lib/workflows/utils'
import type { QueuedWorkflowTriggerType } from '@/services/queue'

const logger = createLogger('WorkflowQueueAPI')

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
  stream?: boolean
  workflowDepth?: number
}

function readQueuedWorkflowTriggerType(value: unknown): QueuedWorkflowTriggerType | null {
  if (value === undefined) return 'manual'
  if (['api', 'manual', 'chat', 'webhook', 'schedule'].includes(value as string)) {
    return value as QueuedWorkflowTriggerType
  }
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

function hasLiveWorkflowState(body: QueueRequestBody) {
  return (
    body.workflowData !== undefined ||
    body.workflowVariables !== undefined ||
    (typeof body.startBlockId === 'string' && body.startBlockId.length > 0)
  )
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

    if (
      !accessContext.isOwner &&
      !accessContext.isWorkspaceOwner &&
      accessContext.workspacePermission === null
    ) {
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
    if (executionTarget === 'deployed' && hasLiveWorkflowState(body)) {
      return NextResponse.json(
        { error: 'Deployed workflow executions cannot include live workflow state' },
        { status: 400 }
      )
    }
    if (
      (triggerType === 'webhook' || triggerType === 'schedule') &&
      (executionTarget !== 'live' ||
        typeof body.startBlockId !== 'string' ||
        body.startBlockId.length === 0)
    ) {
      return NextResponse.json(
        { error: 'Webhook and schedule queued workflow executions require a live start block' },
        { status: 400 }
      )
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
        workflowData: executionTarget === 'live' ? body.workflowData : undefined,
        workflowVariables: executionTarget === 'live' ? body.workflowVariables : undefined,
        selectedOutputs: body.selectedOutputs,
        stream: body.stream === true,
        startBlockId:
          executionTarget === 'live' &&
          typeof body.startBlockId === 'string' &&
          body.startBlockId.length > 0
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
    if (!handle.inserted) {
      return NextResponse.json({ error: 'Workflow execution already exists' }, { status: 409 })
    }

    if (body.stream === true) {
      const streamResult = await openWorkflowExecutionEventStream({
        pendingExecutionId,
        workflowId,
        requestId,
      })

      if (!streamResult.ok) {
        throw new Error('Queued workflow execution stream was not found')
      }

      return new NextResponse(streamResult.stream, {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          'X-Execution-Id': pendingExecutionId,
          'X-Task-Id': handle.pendingExecutionId,
        },
      })
    }

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
