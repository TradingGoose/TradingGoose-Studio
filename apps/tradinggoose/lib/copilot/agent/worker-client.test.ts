/** @vitest-environment node */
import { readFileSync } from 'node:fs'
import { decodeJwt } from 'jose'
import { transformSync } from 'next/dist/build/swc'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as internalTokens from '@/lib/auth/internal-token'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { readSseData } from '@/lib/events/stream'
import { createCopilotWorkerClient } from './worker-client'
import {
  type CopilotJob,
  type CopilotWorkerPrepared,
  type CopilotWorkerToolInput,
  StudioToolFrameSchema,
} from './worker-contract'

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
  stage: 'studio',
  target: {
    threadId: job.threadId,
    resourceId: 'resource',
    runId: job.runId,
    toolName: 'list_workflows',
    toolCallId: 'call',
  },
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

it('uses the deployment origin after Next compiles public environment variables', async () => {
  const { code } = transformSync(
    readFileSync(new URL('./worker-client.ts', import.meta.url), 'utf8'),
    {
      jsc: {
        parser: { syntax: 'typescript' },
        target: 'es2022',
        transform: {
          optimizer: {
            globals: {
              vars: { 'process.env.NEXT_PUBLIC_APP_URL': '"https://build.example.test"' },
            },
          },
        },
      },
      module: { type: 'commonjs' },
    }
  )
  const compiled = {} as typeof import('./worker-client')
  new Function('require', 'exports', code)((specifier: string) => {
    if (specifier === '@/lib/auth/internal-token') return internalTokens
    if (specifier === '@/lib/copilot/native/errors') return { NativeTargetError }
    if (specifier === '@/lib/events/stream') return { readSseData }
    if (specifier === './worker-contract') return { StudioToolFrameSchema }
    throw new Error(`Unexpected worker import: ${specifier}`)
  }, compiled)
  const fetcher = vi.fn(async (_url: unknown) => Response.json({ result: null }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://runtime.example.test')
  await compiled.createCopilotWorkerClient(job).call('active', { fence })
  expect(String(fetcher.mock.calls[0][0])).toBe(
    'https://runtime.example.test/api/copilot/native/tool'
  )
})

it('signs each callback for its saved-message job without transferring input or credentials', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T00:00:00Z'))
  const signing = vi.spyOn(internalTokens, 'generateCopilotWorkerToken')
  const originalJob = structuredClone(job)
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const token = new Headers(init!.headers).get('authorization')!.slice('Bearer '.length)
    expect(await internalTokens.verifyCopilotWorkerToken(token, String(init!.body))).toMatchObject({
      actorUserId: 'actor',
      jobId: 'job',
    })
    expect(await internalTokens.verifyInternalTokenDetailed(token)).toEqual({ valid: false })
    const { operation } = JSON.parse(init!.body as string)
    if (operation === 'tool')
      return frame({ generation: 2, response: { result: { success: true } } })
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
    expect(String(url)).toBe('https://studio.example.test/api/copilot/native/tool')
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
  expect(requests[2].signal).toBe(signal)
  expect(job).toEqual(originalJob)
})

it.each([
  ['local', 'http://127.0.0.1:3333'],
  ['trigger', 'https://worker-studio.example.test'],
] as const)(
  'uses the configured %s listener for one fixed route and refuses redirects',
  async (mode, origin) => {
    vi.stubEnv('PORT', '3333')
    vi.stubEnv('COPILOT_STUDIO_ORIGIN', 'https://worker-studio.example.test')
    const fetcher = vi.fn(async (_url: URL, _options: RequestInit) =>
      Response.json({ result: null })
    )
    vi.stubGlobal('fetch', fetcher)
    await createCopilotWorkerClient(job, mode).call('active', { fence })
    expect(String(fetcher.mock.calls[0][0])).toBe(`${origin}/api/copilot/native/tool`)
    expect(fetcher.mock.calls[0][1].redirect).toBe('error')
  }
)

it('drains usage accounting after cancellation', async () => {
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
  const pending = client.call('usage.record', observation, abort.signal)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  abort.abort()
  const result = { total: 0.01 }
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

it.each([
  ['missing result', () => frame({ generation: 2 }), { name: 'ZodError' }],
  ['null result', () => frame({ response: null }), { name: 'ZodError' }],
  [
    'early EOF',
    () => new Response(': keepalive\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    { message: 'Studio tool response ended before acknowledgment' },
  ],
  [
    'HTTP failure',
    () => Response.json({ error: { message: 'Unavailable' } }, { status: 503 }),
    { name: NativeTargetError.name, status: 503 },
  ],
] as const)('rejects an unacknowledged tool outcome: %s', async (_name, response, expected) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response())
  )
  await expect(createCopilotWorkerClient(job).call('tool', tool)).rejects.toMatchObject(expected)
})

it('returns an acknowledged Studio tool error for native tool recovery', async () => {
  const result = { generation: 2, response: { error: 'Server tool execution failed' } }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => frame(result))
  )
  await expect(createCopilotWorkerClient(job).call('tool', tool)).resolves.toEqual(result)
})

function frame(value: unknown) {
  return new Response(`data: ${JSON.stringify(value)}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}
