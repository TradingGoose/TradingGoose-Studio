import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COPILOT_NATIVE_REVISION,
  type CopilotRequest,
  NativeCommandResponseError,
} from './contract'

const state = vi.hoisted(() => ({ config: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/system-services/runtime', () => ({ resolveCopilotApiServiceConfig: state.config }))

import { fetchNativeCompletion, fetchNativeCopilot, readNativeCopilot } from './client'

const request: CopilotRequest = {
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId: 'request-1',
  scope: { actorUserId: 'actor', workspaceId: null },
  command: 'threads.list',
  page: { page: 0, perPage: 100 },
}
beforeEach(() => {
  vi.clearAllMocks()
  state.config.mockResolvedValue({ baseUrl: 'https://copilot.example', apiKey: 'service-fixture' })
  state.fetch.mockResolvedValue(
    Response.json({
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId: request.requestId,
      status: 'threads',
      items: [],
      page: request.page,
      hasMore: false,
    })
  )
  vi.stubGlobal('fetch', state.fetch)
})
afterEach(() => vi.unstubAllGlobals())

describe('fixed native service transport', () => {
  it('uses version query and configured x-api-key with unchanged closed body and actual cancellation', async () => {
    const signal = new AbortController().signal
    await fetchNativeCopilot(request, signal)
    expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
      new URL('https://copilot.example/api/copilot?version=v1'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'service-fixture' },
        body: JSON.stringify(request),
        signal,
      }
    )
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).not.toHaveProperty('version')
  })
  it('uses the distinct exact completion contract and endpoint', async () => {
    await fetchNativeCompletion({
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId: 'title-1',
      scope: request.scope,
      purpose: 'title',
      model: 'anthropic/claude-fable-5',
      messages: [{ role: 'user', content: 'title' }],
      stream: false,
    })
    expect(state.fetch.mock.calls[0][0].toString()).toBe(
      'https://copilot.example/api/completion?version=v1'
    )
  })
  it('refuses absent service authentication or a cancelled invocation before any fetch', async () => {
    state.config.mockResolvedValueOnce({ apiKey: '' })
    await expect(fetchNativeCopilot(request)).rejects.toMatchObject({ status: 503 })
    const controller = new AbortController()
    controller.abort()
    await expect(fetchNativeCopilot(request, controller.signal)).rejects.toThrow()
    expect(state.fetch).not.toHaveBeenCalled()
  })
  it.each([429, 500, 503])(
    'makes one contact for HTTP%s with no transport retry',
    async (status) => {
      state.fetch.mockResolvedValueOnce(new Response(null, { status }))
      expect((await fetchNativeCopilot(request)).status).toBe(status)
      expect(state.fetch).toHaveBeenCalledOnce()
    }
  )
  it('rejects an untrusted top-level connection override before resolving a service key', async () => {
    await expect(
      fetchNativeCopilot(Object.assign({}, request, { url: 'https://attacker.invalid' }))
    ).rejects.toThrow('Invalid native')
    expect(state.config).not.toHaveBeenCalled()
    expect(state.fetch).not.toHaveBeenCalled()
  })
  it('rejects a stale or malformed collected response instead of treating HTTP success as completion', async () => {
    state.fetch.mockResolvedValueOnce(
      Response.json({
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: 'different',
        status: 'threads',
        items: [],
        page: request.page,
        hasMore: false,
      })
    )
    await expect(readNativeCopilot(request)).rejects.toThrow('does not match')
    state.fetch.mockResolvedValueOnce(Response.json({ success: true }))
    await expect(readNativeCopilot(request)).rejects.toThrow('Invalid native')
  })
  it.each([undefined, 0.02, '0.020', '+0.02', '-0', 'not-money'])(
    'refuses accepted response amount %j with one actual transport contact and no coercion',
    async (appliedUsd) => {
      state.fetch.mockResolvedValueOnce(
        Response.json({
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId: request.requestId,
          status: 'completed',
          runId: 'run',
          threadId: 'thread',
          text: 'known output',
          financial: { accepted: true, modelUsd: 'unavailable', appliedUsd },
        })
      )
      await expect(readNativeCopilot(request)).rejects.toThrow('Invalid native')
      expect(state.fetch).toHaveBeenCalledOnce()
    }
  )
  it('refuses a valid correlated collected result for the wrong command', async () => {
    state.fetch.mockResolvedValueOnce(
      Response.json({
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: request.requestId,
        status: 'completed',
        runId: 'run',
        threadId: 'thread',
        text: 'known output',
        financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0.02' },
      })
    )
    const failure = await readNativeCopilot(request).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(NativeCommandResponseError)
    expect(failure).toMatchObject({
      nativeOutcome: {
        status: 'failed',
        error: { code: 'UNCERTAIN', retryable: false, uncertain: true },
        financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0.02' },
      },
    })
    expect(JSON.stringify(failure)).not.toContain('known output')
    expect(state.fetch).toHaveBeenCalledOnce()
  })
})
