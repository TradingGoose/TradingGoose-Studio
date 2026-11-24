import { generateCopilotWorkerToken } from '@/lib/auth/internal-token'
import { CopilotRunCancelled, NativeTargetError } from '@/lib/copilot/native/errors'
import { readSseData } from '@/lib/events/stream'
import {
  type CopilotJob,
  type CopilotWorkerIdentity,
  type CopilotWorkerOperation,
  type CopilotWorkerOperations,
  StudioToolFrameSchema,
} from './worker-contract'

export function createCopilotWorkerClient(job: CopilotJob, mode: 'local' | 'trigger' = 'trigger') {
  const identity: CopilotWorkerIdentity = {
    actorUserId: job.actorUserId,
    workspaceId: job.request.workspaceId,
    threadId: job.threadId,
    runId: job.runId,
    jobId: job.jobId,
  }
  let model: string | undefined
  return {
    async call<K extends CopilotWorkerOperation>(
      operation: K,
      input: CopilotWorkerOperations[K]['input'],
      signal?: AbortSignal
    ): Promise<CopilotWorkerOperations[K]['output']> {
      const { NEXT_PUBLIC_APP_URL, COPILOT_STUDIO_ORIGIN, PORT } = process.env
      const origin =
        mode === 'local'
          ? `http://127.0.0.1:${PORT || '3000'}`
          : COPILOT_STUDIO_ORIGIN || NEXT_PUBLIC_APP_URL
      if (!origin) throw new Error('The Studio origin is required')
      const url = new URL(origin)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('The Studio origin must be an HTTP(S) origin')
      const payload = JSON.stringify({
        identity,
        operation,
        input,
        ...(operation === 'prepare' || operation === 'finalize' ? { job } : {}),
      })
      const token = await generateCopilotWorkerToken({ ...identity, model }, payload)
      const response = await fetch(new URL('/api/copilot/native/tool', url.origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: operation === 'usage.record' ? undefined : signal,
        redirect: 'error',
        body: payload,
      })
      if (operation === 'tool' && response.ok) {
        if (response.body && response.headers.get('content-type')?.includes('text/event-stream')) {
          for await (const event of readSseData(response.body, { signal })) {
            const frame = StudioToolFrameSchema.parse(JSON.parse(event))
            if ('failure' in frame) throw new NativeTargetError(frame.failure, frame.status)
            return frame as CopilotWorkerOperations[K]['output']
          }
        }
        throw new Error('Studio tool response ended before acknowledgment')
      }
      const body = await response.json()
      if (!response.ok) {
        if (body.error?.code === 'RUN_CANCELLED') throw new CopilotRunCancelled()
        throw new NativeTargetError(
          body.error?.message ?? 'Studio operation failed',
          response.status
        )
      }
      if (operation === 'prepare') model = body.result.run.model
      return body.result
    },
  }
}
