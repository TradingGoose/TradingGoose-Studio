/** @vitest-environment node */
import { Agent } from '@mastra/core/agent'
import { InMemoryStore } from '@mastra/core/storage'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { completeCopilot, createCompletionResponse } from './completion'
import type { CompletionRequest } from './contract'

const state = vi.hoisted(() => ({
  model: undefined as any,
  agent: undefined as any,
  admit: vi.fn(),
  accept: vi.fn(),
  create: vi.fn(),
  access: vi.fn(),
  listed: vi.fn(),
  requests: [] as any[],
  storage: undefined as unknown as InMemoryStore,
}))
vi.mock('@/lib/mastra/runtime', () => ({ getCopilotAgent: async () => state.agent }))
vi.mock('@/lib/mastra/connections', () => ({ createConfiguredLanguageModel: () => state.model }))
vi.mock('@/lib/mastra/registry', () => ({
  assertListedModel: (...args: unknown[]) => state.listed(...args),
}))
vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => state.access(...args),
}))
vi.mock('@/lib/billing/native-finance', () => ({
  createFinancialInvocation: (...args: unknown[]) => state.create(...args),
  admitFinancialModelStep: (...args: unknown[]) => state.admit(...args),
  acceptFinancialModelStep: (...args: unknown[]) => state.accept(...args),
}))
const input: CompletionRequest = {
  requestId: 'completion',
  scope: { actorUserId: 'actor', workspaceId: null },
  purpose: 'title',
  model: 'fixture/model',
  messages: [
    { role: 'system', content: 'Only a title' },
    { role: 'user', content: 'Exact first prompt' },
  ],
  stream: false,
}
beforeEach(() => {
  vi.clearAllMocks()
  state.requests.length = 0
  state.access.mockResolvedValue({ hasAccess: true })
  state.create.mockImplementation(async (scope) => ({
    ...scope,
    namespace: 'user:actor',
    key: 'binding',
    fingerprint: 'original',
    workspaceId: scope.workspaceId ?? null,
    workflowId: null,
  }))
  state.admit.mockResolvedValue(undefined)
  state.accept.mockResolvedValue({ appliedUsd: '0.25' })
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
      financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0.25' },
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    })
    expect(state.listed).toHaveBeenCalledWith('fixture/model')
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'actor', purpose: 'title' })
    )
    expect(state.admit).toHaveBeenCalledOnce()
    expect(state.accept).toHaveBeenCalledOnce()
    expect(JSON.stringify(state.requests)).toContain('Exact first prompt')
    expect(
      (await (await state.storage.getStore('memory'))!.listThreads({ page: 0, perPage: 100 }))
        .threads
    ).toEqual([])
  })
  it('streams only text deltas and its completed local outcome', async () => {
    const response = await createCompletionResponse({ ...input, purpose: 'wand', stream: true })
    const text = await response.text()
    expect(text).toContain('"chunk":"Known title"')
    expect(text).toContain('"done":true')
    expect(text).toContain('"appliedUsd":"0.25"')
    expect(text).not.toContain('Exact first prompt')
    expect(state.accept).toHaveBeenCalledOnce()
  })
  it('rejects revoked workspace access before billing or model contact', async () => {
    state.access.mockResolvedValueOnce({ hasAccess: false })
    expect(
      await completeCopilot({ ...input, scope: { actorUserId: 'actor', workspaceId: 'revoked' } })
    ).toMatchObject({ status: 'refused', financialDisposition: 'not_contacted' })
    expect(state.create).not.toHaveBeenCalled()
    expect(state.requests).toHaveLength(0)
  })
  it('does not contact an already cancelled request', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await completeCopilot(input, controller.signal)).toMatchObject({
      status: 'cancel_requested',
      financialDisposition: 'not_contacted',
    })
    expect(state.create).not.toHaveBeenCalled()
    expect(state.requests).toHaveLength(0)
  })
  it('does not claim success when authoritative accounting fails', async () => {
    state.accept.mockRejectedValueOnce(new Error('accounting unavailable'))
    expect(await completeCopilot(input)).toMatchObject({
      status: 'failed',
      financialDisposition: 'uncertain',
      uncertain: true,
    })
    expect(state.requests).toHaveLength(1)
  })

  it('keeps acknowledged usage and accounting when cancellation wins after the model response', async () => {
    const controller = new AbortController()
    state.accept.mockImplementationOnce(async () => {
      controller.abort()
      return { appliedUsd: '0.25' }
    })
    expect(await completeCopilot(input, controller.signal)).toMatchObject({
      status: 'cancel_requested',
      financialDisposition: 'accepted',
      financial: { accepted: true, appliedUsd: '0.25' },
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    })
    expect(state.requests).toHaveLength(1)
  })
})
