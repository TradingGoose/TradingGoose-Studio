/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPILOT_NATIVE_REVISION } from '@/lib/copilot/native/contract'
import { requestCopilotTitle } from './utils'

const state = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveCopilotApiServiceConfig: async () => ({
    baseUrl: 'https://copilot.example',
    apiKey: 'service-fixture',
  }),
}))
const input = {
  message: 'Build a screener',
  userId: 'actor',
  workspaceId: null,
  model: 'openai/gpt-5.6-terra' as const,
}
function response(outcome: Record<string, unknown>, requestId: string, status = 200) {
  return Response.json(
    { protocolRevision: COPILOT_NATIVE_REVISION, requestId, ...outcome },
    { status }
  )
}
const completed = {
  status: 'completed',
  runId: 'native-title-run',
  text: '  Momentum Screener  ',
  financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0' },
}
function failure(
  financialDisposition: 'accepted' | 'not_contacted' | 'uncertain',
  status: 'failed' | 'refused' | 'cancel_requested' = 'failed'
) {
  const uncertain = financialDisposition === 'uncertain'
  return {
    status,
    uncertain,
    financialDisposition,
    error: { code: 'NATIVE_FAILURE', message: 'Title unavailable', retryable: false, uncertain },
    ...(financialDisposition === 'accepted' ? { financial: completed.financial } : {}),
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', state.fetch)
  state.fetch.mockImplementation(async (_url, options: RequestInit) =>
    response(completed, JSON.parse(String(options.body)).requestId)
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('native title completion adapter', () => {
  it.each(['openai/gpt-5.6-terra', 'anthropic/claude-opus-5'] as const)(
    'preserves exact selected %s with authenticated personal scope',
    async (model) => {
      const signal = new AbortController().signal
      expect(await requestCopilotTitle({ ...input, model, signal })).toBe('Momentum Screener')
      expect(state.fetch).toHaveBeenCalledOnce()
      const [url, init] = state.fetch.mock.calls[0]
      expect(String(url)).toBe('https://copilot.example/api/completion?version=v1')
      expect(init.signal).toBe(signal)
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        'x-api-key': 'service-fixture',
      })
      expect(JSON.parse(init.body)).toMatchObject({
        protocolRevision: COPILOT_NATIVE_REVISION,
        scope: { actorUserId: 'actor', workspaceId: null },
        purpose: 'title',
        model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'Generate a concise, descriptive chat title based on the user message.',
          },
          { role: 'user', content: 'Create a short title for this: Build a screener' },
        ],
      })
    }
  )
  it('uses the real conversation workspace rather than a fabricated personal scope', async () => {
    expect(await requestCopilotTitle({ ...input, workspaceId: 'conversation-workspace' })).toBe(
      'Momentum Screener'
    )
    expect(JSON.parse(state.fetch.mock.calls[0][1].body).scope.workspaceId).toBe(
      'conversation-workspace'
    )
  })
  it('exposes accepted native outcome before returning a successful title', async () => {
    const onOutcome = vi.fn()
    expect(await requestCopilotTitle({ ...input, onOutcome })).toBe('Momentum Screener')
    expect(onOutcome).toHaveBeenCalledOnce()
    expect(onOutcome.mock.calls[0][0]).toMatchObject(completed)
  })
  it.each([
    failure('accepted'),
    failure('accepted', 'cancel_requested'),
    failure('not_contacted', 'refused'),
    failure('uncertain'),
  ])(
    'returns null for explicit failure/cancel while preserving the received outcome: %j',
    async (outcome) => {
      const onOutcome = vi.fn()
      state.fetch.mockImplementationOnce(async (_url, options: RequestInit) =>
        response(outcome, JSON.parse(String(options.body)).requestId, 503)
      )
      expect(await requestCopilotTitle({ ...input, onOutcome })).toBeNull()
      expect(onOutcome).toHaveBeenCalledOnce()
      expect(onOutcome.mock.calls[0][0]).toMatchObject(outcome)
      expect(state.fetch).toHaveBeenCalledOnce()
    }
  )
  it.each([
    { choices: [{ message: { content: 'legacy' } }] },
    { ...completed, requestId: 'stale' },
  ])('refuses raw or stale successful payloads: %j', async (payload) => {
    const onOutcome = vi.fn()
    state.fetch.mockImplementationOnce(async (_url, options: RequestInit) =>
      response(payload, JSON.parse(String(options.body)).requestId)
    )
    expect(await requestCopilotTitle({ ...input, onOutcome })).toBeNull()
    expect(onOutcome).not.toHaveBeenCalled()
    expect(state.fetch).toHaveBeenCalledOnce()
  })
  it('requires a nonempty completed title and never publishes a whitespace title', async () => {
    state.fetch.mockImplementationOnce(async (_url, options: RequestInit) =>
      response({ ...completed, text: '  ' }, JSON.parse(String(options.body)).requestId)
    )
    expect(await requestCopilotTitle(input)).toBeNull()
  })
  it('preserves an accepted outcome if cancellation wins before the title commit', async () => {
    const controller = new AbortController()
    const onOutcome = vi.fn()
    state.fetch.mockImplementationOnce(async (_url, options: RequestInit) => {
      controller.abort()
      return response(completed, JSON.parse(String(options.body)).requestId)
    })
    expect(await requestCopilotTitle({ ...input, signal: controller.signal, onOutcome })).toBeNull()
    expect(onOutcome).toHaveBeenCalledOnce()
    expect(state.fetch).toHaveBeenCalledOnce()
  })
  it('does not contact or retry after actual cancellation/network failure', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await requestCopilotTitle({ ...input, signal: controller.signal })).toBeNull()
    expect(state.fetch).not.toHaveBeenCalled()
    state.fetch.mockRejectedValueOnce(new Error('connection lost'))
    expect(await requestCopilotTitle(input)).toBeNull()
    expect(state.fetch).toHaveBeenCalledOnce()
  })
})
