/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateCopilotWorkerToken, generateInternalToken } from '@/lib/auth/internal-token'
import { POST } from './route'

const handler = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copilot/agent/worker-server', () => ({ handleCopilotWorkerOperation: handler }))
const identity = {
  actorUserId: 'actor',
  workspaceId: 'workspace',
  jobId: 'job',
  threadId: 'thread',
  runId: 'run',
}
const fence = { runId: 'thread-owner', ownerId: identity.runId, generation: 1 }

beforeEach(() => {
  vi.stubEnv('INTERNAL_API_SECRET', 'test-internal-signing-secret-123456')
  handler.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

async function request(token?: string, body: Record<string, unknown> = {}) {
  return POST(
    new Request('https://studio.example.test/api/copilot/worker', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ identity, operation: 'active', input: { fence }, ...body }),
    })
  )
}

it.each(['missing', 'ordinary-internal', 'invalid'])(
  'rejects %s authentication before business operations',
  async (kind) => {
    const token =
      kind === 'ordinary-internal'
        ? await generateInternalToken(identity.actorUserId)
        : kind === 'invalid'
          ? 'invalid'
          : undefined
    expect((await request(token)).status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  }
)
it.each(['actorUserId', 'workspaceId', 'jobId', 'threadId', 'runId'])(
  'rejects a changed %s scope',
  async (field) => {
    const token = await generateCopilotWorkerToken(identity)
    expect((await request(token, { identity: { ...identity, [field]: 'another' } })).status).toBe(
      403
    )
    expect(handler).not.toHaveBeenCalled()
  }
)
it('admits an authenticated scope and disables caching', async () => {
  const token = await generateCopilotWorkerToken(identity)
  const response = await request(token)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(handler).toHaveBeenCalledExactlyOnceWith(
    identity,
    'active',
    { fence },
    expect.any(AbortSignal)
  )
})
it('uses the signed model for completion accounting without requiring a current lease in its envelope', async () => {
  const token = await generateCopilotWorkerToken({ ...identity, model: 'openai/model' })
  const input = { attemptId: 'run:attempt:1:0', usage: { inputTokens: 12, outputTokens: 3 } }
  const cost = { status: 'estimated', total: 0.01 }
  handler.mockResolvedValueOnce(cost)
  const response = await request(token, { operation: 'usage.record', input })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ result: cost })
  expect(handler).toHaveBeenCalledExactlyOnceWith(
    { ...identity, model: 'openai/model' },
    'usage.record',
    input,
    expect.any(AbortSignal)
  )
})
