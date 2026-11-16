/** @vitest-environment node */
import { decodeJwt } from 'jose'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as internalTokens from '@/lib/auth/internal-token'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { createCopilotWorkerClient } from './worker-client'
import type { CopilotJob, CopilotWorkerPrepared, CopilotWorkerToolInput } from './worker-contract'

const job: CopilotJob = {
  request: {
    command: 'message',
    requestId: '328ef60d-359d-4de0-99d4-5af8e5423c38',
    workspaceId: 'workspace',
    model: 'openai/gpt-4.1',
  },
  actorUserId: 'actor',
  toolContexts: [],
  threadId: 'thread',
  runId: 'run',
  jobId: 'job',
  messageId: 'message',
}
const prepared: CopilotWorkerPrepared = {
  run: {
    runId: job.runId,
    threadId: job.threadId,
    scope: { actorUserId: job.actorUserId, workspaceId: job.request.workspaceId },
    model: 'openai/gpt-4.1',
    accessLevel: 'limited',
  },
  contexts: [],
  model: { providerId: 'openai', modelId: 'gpt-4.1', apiKey: 'synthetic-turn-only-key' },
}
const fence = { runId: 'thread-ownership', ownerId: job.runId, generation: 1 }
const tool: CopilotWorkerToolInput = {
  run: prepared.run,
  toolName: 'list_workflows',
  args: { workspaceId: 'workspace' },
  toolCallId: 'call',
  fence,
}
const observation = { attemptId: 'attempt', usage: { inputTokens: 1, outputTokens: 2 } }

beforeEach(() => {
  vi.stubEnv('INTERNAL_API_SECRET', 'synthetic-worker-test-signing-key-only')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studio.example.test')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('signs each callback for its saved-message job without transferring input or credentials', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T00:00:00Z'))
  const signing = vi.spyOn(internalTokens, 'generateCopilotWorkerToken')
  const originalJob = structuredClone(job)
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const token = new Headers(init!.headers).get('authorization')!.slice('Bearer '.length)
    expect(await internalTokens.verifyCopilotWorkerToken(token)).toMatchObject({
      actorUserId: 'actor',
      jobId: 'job',
    })
    expect(await internalTokens.verifyInternalTokenDetailed(token)).toEqual({ valid: false })
    const { operation } = JSON.parse(init!.body as string)
    return Response.json({ result: operation === 'prepare' ? prepared : null })
  })
  vi.stubGlobal('fetch', fetcher)
  const client = createCopilotWorkerClient(job)
  const signal = new AbortController().signal
  await client.call('prepare', { fence }, signal)
  vi.setSystemTime(new Date('2026-11-16T00:10:00Z'))
  await client.call('active', { fence }, signal)
  await client.call('tool', tool, signal)
  await client.call('usage.allow', { fence }, signal)
  await client.call('usage.record', observation, signal)
  await client.call('cancel', {}, signal)
  await client.call('finalize', { message: 'Worker interrupted' }, signal)
  expect(signing).toHaveBeenCalledTimes(fetcher.mock.calls.length)
  const requests = fetcher.mock.calls.map(([url, init]) => {
    expect(String(url)).toBe('https://studio.example.test/api/copilot/worker')
    const body = JSON.parse(init!.body as string)
    const token = new Headers(init!.headers).get('authorization')!.slice('Bearer '.length)
    const claims = decodeJwt(token)
    expect(claims.type).toBe('copilot-worker')
    expect(claims.exp! - claims.iat!).toBe(300)
    expect(JSON.stringify({ body, claims })).not.toContain(prepared.model.apiKey)
    expect(body).not.toHaveProperty('job.request.input')
    expect(claims).not.toHaveProperty('input')
    if (body.operation === 'prepare' || body.operation === 'finalize') expect(body.job).toEqual(job)
    else expect(body).not.toHaveProperty('job')
    return { body, claims, signal: init!.signal }
  })
  expect(requests[0].claims).not.toHaveProperty('model')
  expect(requests[1].claims).toMatchObject({
    model: prepared.run.model,
    iat: requests[0].claims.iat! + 600,
  })
  expect(requests[1].signal).toBe(signal)
  expect(job).toEqual(originalJob)
})

it.each(['tool', 'usage.record'] as const)('drains %s after cancellation', async (operation) => {
  let complete!: (response: Response) => void
  const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
    expect(init!.signal).toBeUndefined()
    return new Promise<Response>((resolve) => {
      complete = resolve
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const abort = new AbortController()
  const client = createCopilotWorkerClient(job)
  const pending =
    operation === 'tool'
      ? client.call(operation, tool, abort.signal)
      : client.call(operation, observation, abort.signal)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  abort.abort()
  const result =
    operation === 'tool' ? { result: { success: true } } : { status: 'estimated', total: 0.01 }
  complete(Response.json({ result }))
  await expect(pending).resolves.toEqual(result)
})

it.each([403, 409, 503])(
  'preserves Studio refusal status %s and its explanation',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: { message: 'Current job refused' } }, { status }))
    )
    await expect(createCopilotWorkerClient(job).call('active', { fence })).rejects.toMatchObject({
      name: NativeTargetError.name,
      status,
      message: 'Current job refused',
    })
  }
)
