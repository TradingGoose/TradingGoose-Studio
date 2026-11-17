import { generateCopilotWorkerToken } from '@/lib/auth/internal-token'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import type {
  CopilotJob,
  CopilotWorkerIdentity,
  CopilotWorkerOperation,
  CopilotWorkerOperations,
} from './worker-contract'

export function createCopilotWorkerClient(job: CopilotJob) {
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
      const { NEXT_PUBLIC_APP_URL: origin } = process.env
      if (!origin) throw new Error('NEXT_PUBLIC_APP_URL is required')
      const token = await generateCopilotWorkerToken({ ...identity, model })
      const response = await fetch(new URL('/api/copilot/worker', origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: operation === 'tool' || operation === 'usage.record' ? undefined : signal,
        body: JSON.stringify({
          identity,
          operation,
          input,
          ...(operation === 'prepare' || operation === 'finalize' ? { job } : {}),
        }),
      })
      const body = await response.json()
      if (!response.ok)
        throw new NativeTargetError(
          body.error?.message ?? 'Studio operation failed',
          response.status
        )
      if (operation === 'prepare') model = body.result.run.model
      return body.result as CopilotWorkerOperations[K]['output']
    },
  }
}
