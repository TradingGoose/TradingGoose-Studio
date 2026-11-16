import { verifyCopilotWorkerToken } from '@/lib/auth/internal-token'
import { copilotFailure } from '@/lib/copilot/agent/errors'
import { CopilotWorkerRequestSchema } from '@/lib/copilot/agent/worker-contract'
import { handleCopilotWorkerOperation } from '@/lib/copilot/agent/worker-server'
import { NativeTargetError } from '@/lib/copilot/native/errors'

export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
    const authenticated = token ? await verifyCopilotWorkerToken(token) : undefined
    if (!authenticated) throw new NativeTargetError('Internal Copilot authentication required', 401)
    const body = CopilotWorkerRequestSchema.parse(await request.json())
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
