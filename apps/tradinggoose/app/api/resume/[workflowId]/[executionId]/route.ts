import { type NextRequest, NextResponse } from 'next/server'
import { AuthType, checkHybridAuth } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { createLogger } from '@/lib/logs/console/logger'
import {
  readWorkflowCheckpoint,
  submitWorkflowCheckpoint,
  WorkflowCheckpointError,
} from '@/lib/workflows/human-in-the-loop/service'

const logger = createLogger('WorkflowReview')
type RouteContext = { params: Promise<{ workflowId: string; executionId: string }> }

async function handleReview(request: NextRequest, context: RouteContext) {
  try {
    const { workflowId, executionId } = await context.params
    const auth = await checkHybridAuth(request)
    if (auth.authType === AuthType.INTERNAL_JWT) {
      return NextResponse.json({ error: 'A user session or API key is required' }, { status: 403 })
    }
    const submitting = request.method === 'POST'
    const access = await authorizeWorkflowScope(auth, workflowId, submitting ? 'write' : 'read')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    if (submitting) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        return NextResponse.json(
          { error: 'Content-Type must be application/json' },
          { status: 415 }
        )
      }
      const text = await request.text()
      if (text.length > 256_000)
        return NextResponse.json({ error: 'Resume input is too large' }, { status: 413 })
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return NextResponse.json({ error: 'Invalid review submission' }, { status: 400 })
      const { revision, pausePointId, input } = body as Record<string, unknown>
      if (
        !Number.isSafeInteger(revision) ||
        (revision as number) < 1 ||
        typeof pausePointId !== 'string' ||
        !pausePointId ||
        pausePointId.length > 512
      ) {
        return NextResponse.json(
          { error: 'A valid revision and pausePointId are required' },
          { status: 400 }
        )
      }
      const checkpoint = await submitWorkflowCheckpoint({
        executionId,
        workflowId,
        workspaceId: access.workspaceId,
        reviewerId: access.userId,
        revision: revision as number,
        pausePointId,
        input,
      })
      return NextResponse.json(
        { ...checkpoint, canSubmit: true },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const checkpoint = await readWorkflowCheckpoint(executionId, workflowId, access.workspaceId)
    if (!checkpoint)
      return NextResponse.json({ error: 'Paused execution not found' }, { status: 404 })
    const writable = await authorizeWorkflowScope(auth, workflowId, 'write')
    return NextResponse.json(
      { ...checkpoint, canSubmit: writable.ok },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    if (error instanceof WorkflowCheckpointError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    logger.error('Workflow review failed', error)
    return NextResponse.json(
      { error: 'Unable to process workflow review. Retry your request.' },
      { status: 500 }
    )
  }
}

export const GET = handleReview
export const POST = handleReview
