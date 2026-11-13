/** @vitest-environment node */
import { Agent } from '@mastra/core/agent'
import { InMemoryStore } from '@mastra/core/storage'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { completeCopilot, createCompletionResponse } from './completion'
import type { CompletionRequest } from './contract'

const state = vi.hoisted(() => ({
  model: undefined as any,
  agent: undefined as any,
  admit: vi.fn(),
  accept: vi.fn(),
  access: vi.fn(),
  resolve: vi.fn(),
  requests: [] as any[],
  storage: undefined as unknown as InMemoryStore,
}))
vi.mock('@/lib/mastra/runtime', () => ({
  getMastra: async () => undefined,
  getCopilotAgent: async () => state.agent,
}))
vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<object>()),
  createConfiguredLanguageModel: vi.fn(() => state.model),
}))
vi.mock('@/lib/copilot/settings.server', () => ({ resolveCopilotModel: state.resolve }))
vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => state.access(...args),
}))
vi.mock('@/lib/billing/model-usage', () => ({
  beginWorkflowModelUsage: async () => false,
  assertModelUsageAllowed: (...args: unknown[]) => state.admit(...args),
  recordModelUsage: (...args: unknown[]) => state.accept(...args),
}))
const input: CompletionRequest = {
  scope: { actorUserId: 'actor', workspaceId: null },
  purpose: 'title',
  model: 'openai/gpt-4o',
  messages: [
    { role: 'system', content: 'Only a title' },
    { role: 'user', content: 'Exact first prompt' },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  state.requests.length = 0
  state.access.mockResolvedValue({ hasAccess: true })
  state.resolve.mockReset().mockImplementation(async (model: string) => ({
    model,
    apiKey: 'admin-key',
  }))
  state.admit.mockResolvedValue(undefined)
  state.accept.mockImplementation(async (_scope, _usage, cost) => cost)
  state.model = new MastraLanguageModelV2Mock({
    doGenerate: async (request) => {
      state.requests.push(request)
      return {
        content: [{ type: 'text', text: 'Known title' }],
        finishReason: 'stop',
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        warnings: [],
      }
    },
    doStream: async (request) => {
      state.requests.push(request)
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'answer' })
            controller.enqueue({ type: 'text-delta', id: 'answer', delta: 'Known title' })
            controller.enqueue({ type: 'text-end', id: 'answer' })
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
            })
            controller.close()
          },
        }),
      }
    },
  })
  state.storage = new InMemoryStore()
  state.agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'copilot',
    name: 'Copilot',
    instructions: '',
    model: state.model,
    memory: new Memory({ storage: state.storage, options: { generateTitle: false } }),
  })
})
describe('built-in stateless completions', () => {
  it('uses the shared agent, exact selected model, and authoritative Studio billing', async () => {
    const result = await completeCopilot(input)
    expect(result).toMatchObject({
      status: 'completed',
      text: 'Known title',
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    })
    expect(state.resolve).toHaveBeenCalledWith(input.model)
    expect(createConfiguredLanguageModel).toHaveBeenCalledWith(input.model, 'admin-key')
    expect(state.admit).toHaveBeenCalledOnce()
    expect(state.accept).toHaveBeenCalledOnce()
    expect(state.accept.mock.calls[0][0]).toMatchObject({ model: input.model, purpose: 'title' })
    expect(state.accept.mock.calls[0][2]).toMatchObject({
      total: expect.closeTo(0.000015, 12),
      status: 'estimated',
      currency: 'USD',
    })
    expect(JSON.stringify(state.requests)).toContain('Exact first prompt')
    expect(JSON.stringify(state.requests)).not.toContain('admin-key')
    expect(
      (await (await state.storage.getStore('memory'))!.listThreads({ page: 0, perPage: 100 }))
        .threads
    ).toEqual([])
  })
  it('streams only text deltas and its completed local outcome', async () => {
    const response = await createCompletionResponse({ ...input, purpose: 'wand' })
    const text = await response.text()
    expect(text).toContain('"chunk":"Known title"')
    expect(text).toContain('"done":true')
    expect(text).not.toContain('Exact first prompt')
    expect(state.accept).toHaveBeenCalledOnce()
  })
  it('rejects revoked workspace access before billing or model contact', async () => {
    state.access.mockResolvedValueOnce({ hasAccess: false })
    expect(
      await completeCopilot({ ...input, scope: { actorUserId: 'actor', workspaceId: 'revoked' } })
    ).toMatchObject({ status: 'refused' })
    expect(state.requests).toHaveLength(0)
  })
  it.each([409, 422])(
    'refuses unavailable admin configuration (%i) before billing or inference',
    async (status) => {
      state.resolve.mockRejectedValueOnce(
        new NativeTargetError('Copilot model unavailable', status)
      )
      expect(await completeCopilot(input)).toMatchObject({ status: 'refused' })
      expect(state.admit).not.toHaveBeenCalled()
      expect(createConfiguredLanguageModel).not.toHaveBeenCalled()
      expect(state.requests).toHaveLength(0)
    }
  )
  it('rejects later completions after key removal without reusing the warmed Agent model', async () => {
    expect(await completeCopilot(input)).toMatchObject({ status: 'completed' })
    const agent = state.agent
    state.resolve.mockRejectedValue(
      new NativeTargetError('The Copilot API key is not configured', 409)
    )

    expect(await completeCopilot(input)).toMatchObject({
      status: 'refused',
      error: { message: 'The Copilot API key is not configured' },
    })
    const response = await createCompletionResponse({ ...input, purpose: 'wand' })
    const text = await response.text()
    expect(text).toContain('"refusal":true')
    expect(text).toContain('The Copilot API key is not configured')
    expect(state.agent).toBe(agent)
    expect(state.resolve).toHaveBeenCalledTimes(3)
    expect(createConfiguredLanguageModel).toHaveBeenCalledExactlyOnceWith(input.model, 'admin-key')
    expect(state.requests).toHaveLength(1)
    expect(state.admit).toHaveBeenCalledOnce()
    expect(state.accept).toHaveBeenCalledOnce()
  })
  it('runs an administrator model without requiring installed registry or price metadata', async () => {
    const model = 'openai/new-admin-model'
    expect(await completeCopilot({ ...input, model })).toMatchObject({ status: 'completed' })
    expect(state.resolve).toHaveBeenCalledWith(model)
    expect(createConfiguredLanguageModel).toHaveBeenCalledWith(model, 'admin-key')
  })
  it('does not contact an already cancelled request', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await completeCopilot(input, controller.signal)).toMatchObject({
      status: 'cancel_requested',
    })
    expect(state.requests).toHaveLength(0)
  })
  it('does not claim success when authoritative accounting fails', async () => {
    state.accept.mockRejectedValueOnce(new Error('accounting unavailable'))
    expect(await completeCopilot(input)).toMatchObject({
      status: 'failed',
    })
    expect(state.requests).toHaveLength(1)
  })
  it('keeps arbitrary administrator credentials out of provider failure responses', async () => {
    const credential = 'opaque-value-that-does-not-match-a-secret-pattern'
    state.resolve.mockResolvedValue({ model: input.model, apiKey: credential })
    const fail = async () => {
      throw new Error(`Upstream rejected ${credential}`)
    }
    state.model.doGenerate = fail
    state.model.doStream = fail
    const result = await completeCopilot(input)
    expect(result).toMatchObject({
      status: 'failed',
      error: { message: 'Copilot completion did not complete' },
    })
    expect(JSON.stringify(result)).not.toContain(credential)
    const text = await (await createCompletionResponse({ ...input, purpose: 'wand' })).text()
    expect(text).not.toContain(credential)
    expect(text).toContain('Copilot completion did not complete')
  })

  it('keeps observed usage when cancellation wins after the model response', async () => {
    const controller = new AbortController()
    state.accept.mockImplementationOnce(async (_scope, _usage, cost) => {
      controller.abort()
      return cost
    })
    expect(await completeCopilot(input, controller.signal)).toMatchObject({
      status: 'cancel_requested',
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    })
    expect(state.requests).toHaveLength(1)
  })
})
