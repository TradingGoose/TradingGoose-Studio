import { verifyCopilotWorkerToken } from '@/lib/auth/internal-token'
import { copilotFailure } from '@/lib/copilot/agent/errors'
import {
  CopilotWorkerRequestSchema,
  CopilotWorkerToolInputSchema,
} from '@/lib/copilot/agent/worker-contract'
import { handleCopilotWorkerOperation } from '@/lib/copilot/agent/worker-server'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'

export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
    const rawBody = await request.text()
    const authenticated = token ? await verifyCopilotWorkerToken(token, rawBody) : undefined
    if (!authenticated) throw new NativeTargetError('Internal Copilot authentication required', 401)
    const body = CopilotWorkerRequestSchema.parse(JSON.parse(rawBody))
    if ((body.operation === 'prepare' || body.operation === 'finalize') !== Boolean(body.job))
      throw new NativeTargetError(
        'The original job is required only for preparation and finalization',
        422
      )
    const identity = body.identity
    if (
      identity.actorUserId !== authenticated.actorUserId ||
      identity.workspaceId !== authenticated.workspaceId ||
      identity.threadId !== authenticated.threadId ||
      identity.runId !== authenticated.runId ||
      identity.jobId !== authenticated.jobId
    )
      throw new NativeTargetError('Copilot worker scope has changed', 403)
    if (
      body.job &&
      (body.job.actorUserId !== identity.actorUserId ||
        body.job.request.workspaceId !== identity.workspaceId ||
        body.job.jobId !== identity.jobId ||
        body.job.threadId !== identity.threadId ||
        body.job.runId !== identity.runId)
    )
      throw new NativeTargetError('Copilot job belongs to another scope', 403)
    if (body.operation === 'tool') {
      const input = CopilotWorkerToolInputSchema.parse(body.input)
      const connection = new AbortController()
      const signal = AbortSignal.any([request.signal, connection.signal])
      const heartbeat = new TextEncoder().encode(': keepalive\n\n')
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(heartbeat)
          const timer = setInterval(() => {
            if (!signal.aborted) controller.enqueue(heartbeat)
          }, 25_000)
          const clear = () => clearInterval(timer)
          signal.addEventListener('abort', clear, { once: true })
          void handleCopilotWorkerOperation(authenticated, 'tool', input, signal)
            .then((frame) => {
              if (!signal.aborted) controller.enqueue(encodeSSE(frame))
            })
            .catch((error) => {
              if (!signal.aborted)
                controller.enqueue(
                  encodeSSE({
                    failure: copilotFailure(error).error.message,
                    status: error instanceof NativeTargetError ? error.status : 503,
                  })
                )
            })
            .finally(() => {
              clear()
              signal.removeEventListener('abort', clear)
              if (!connection.signal.aborted) controller.close()
            })
        },
        cancel(reason) {
          connection.abort(reason)
        },
      })
      return new Response(stream, {
        headers: { ...SSE_HEADERS, 'Cache-Control': 'no-store, no-transform' },
      })
    }
    const result = await handleCopilotWorkerOperation(
      body.job ?? { ...identity, model: authenticated.model },
      body.operation,
      body.input as never,
      request.signal
    )
    return Response.json({ result: result ?? null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status =
      error instanceof NativeTargetError
        ? error.status
        : error instanceof Error && error.name === 'ZodError'
          ? 422
          : 503
    return Response.json(copilotFailure(error), {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
