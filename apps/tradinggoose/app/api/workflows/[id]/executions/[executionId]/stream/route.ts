import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import { formatWorkflowExecutionSSE, isTerminalWorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import { readWorkflowAccessContext } from '@/lib/workflows/utils'
import { SSE_HEADERS } from '@/lib/utils'

const logger = createLogger('WorkflowExecutionStreamAPI')
const POLL_INTERVAL_MS = 500
const MAX_POLL_DURATION_MS = 55 * 60 * 1000

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const hasReadAccess = (
  accessContext: Awaited<ReturnType<typeof readWorkflowAccessContext>>
) =>
  Boolean(
    accessContext &&
      (accessContext.isOwner || accessContext.workspacePermission !== null)
  )

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

    const accessContext = await readWorkflowAccessContext(workflowId, auth.userId)
    if (!accessContext?.workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (!hasReadAccess(accessContext)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const initialState = await readWorkflowExecutionEventState({
      pendingExecutionId: executionId,
      workflowId,
      afterEventId: fromEventId,
    })

    if (!initialState) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    let closed = false
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let lastEventId = fromEventId
        const deadline = Date.now() + MAX_POLL_DURATION_MS

        const enqueue = (chunk: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            closed = true
          }
        }

        const enqueueEvents = async () => {
          const state = await readWorkflowExecutionEventState({
            pendingExecutionId: executionId,
            workflowId,
            afterEventId: lastEventId,
          })

          if (!state) {
            throw new Error('Workflow execution stream was not found')
          }

          let sawTerminalEvent = false
          for (const entry of state.events) {
            if (closed) break
            enqueue(formatWorkflowExecutionSSE(entry.event))
            lastEventId = entry.eventId
            sawTerminalEvent ||= isTerminalWorkflowExecutionEvent(entry.event)
          }

          if (
            !sawTerminalEvent &&
            (state.status === 'completed' || state.status === 'failed')
          ) {
            throw new Error('Workflow execution ended without a terminal stream event')
          }

          return sawTerminalEvent
        }

        try {
          while (!closed && Date.now() < deadline) {
            if (await enqueueEvents()) {
              enqueue('data: [DONE]\n\n')
              if (!closed) controller.close()
              return
            }
            await sleep(POLL_INTERVAL_MS)
          }

          if (!closed) {
            throw new Error('Workflow execution stream ended before completion')
          }
        } catch (error) {
          logger.error('Workflow execution stream failed', {
            workflowId,
            executionId,
            error,
          })
          if (!closed) controller.error(error)
        }
      },
      cancel() {
        closed = true
      },
    })

    return new NextResponse(stream, {
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
      { error: error instanceof Error ? error.message : 'Failed to open workflow execution stream' },
      { status: 500 }
    )
  }
}
