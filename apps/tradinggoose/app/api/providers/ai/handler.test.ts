import { setManagedProviders } from '@/lib/mastra/__test-utils__/managed-services'

vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: (id: string, apiKey?: string) => ({ id, apiKey }),
}))
vi.mock('@/lib/mastra/usage-processors', () => ({
  usageProcessors: async (scope: unknown) => {
    native.finance(scope)
    return {
      inputProcessors: [],
      outputProcessors: [],
      getUsage: () => native.usage(),
      getCost: () => native.cost(),
      verifyComplete: async () => {},
    }
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAIProviderRequest } from './handler'

const native = vi.hoisted(() => ({
  finance: vi.fn(),
  cost: vi.fn(),
  generate: vi.fn(),
  configurations: [] as any[],
  usage: vi.fn(),
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(configuration: any) {
      native.configurations.push(configuration)
    }
    generate = native.generate
  },
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
const result = {
  text: '价格 📈',
  finishReason: 'stop',
  totalUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  steps: [],
}
beforeEach(() => {
  vi.clearAllMocks()
  native.cost.mockReset().mockReturnValue({ status: 'unavailable' })
  native.usage.mockReset().mockReturnValue(result.totalUsage)
  native.configurations.length = 0
  native.generate.mockResolvedValue(result)
})
describe('native AI HTTP handler', () => {
  it.each([
    { apiKey: undefined, funding: 'account' },
    { apiKey: '', funding: 'account' },
    { apiKey: 'caller-key', funding: 'byok' },
  ])(
    'derives $funding funding from the selected request key $apiKey',
    async ({ apiKey, funding }) => {
      const response = await handleAIProviderRequest({
        body: {
          model: 'openai/gpt-4.1',
          apiKey,
          funding: funding === 'byok' ? 'account' : 'byok',
        } as any,
        requestId: 'credential-origin',
        authUserId: 'actor',
      })

      expect(response.status).toBe(200)
      expect(native.finance).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'actor', funding })
      )
      expect(JSON.stringify(native.finance.mock.calls)).not.toContain('caller-key')
    }
  )

  it('requires and exactly validates the resolved canonical model', async () => {
    const missing = await handleAIProviderRequest({ body: {}, requestId: 'missing' })
    expect(missing.status).toBe(400)
    await expect(
      handleAIProviderRequest({ body: { model: 'gpt-4.1' }, requestId: 'bare' })
    ).rejects.toThrow()
    expect(native.generate).not.toHaveBeenCalled()
  })
  it('passes canonical Anthropic routing and request-local keys directly to Mastra', async () => {
    const cost = { total: 0.005, currency: 'USD', status: 'estimated' }
    native.cost.mockReturnValue(cost)
    const response = await handleAIProviderRequest({
      body: {
        model: 'anthropic/claude-sonnet-4-5',
        apiKey: 'tenant-key',
        messages: [{ role: 'user', content: 'Analyze' }],
        modelSettings: { maxOutputTokens: 51 },
      },
      requestId: 'anthropic',
    })
    expect(native.configurations[0].model).toEqual({
      id: 'anthropic/claude-sonnet-4-5',
      apiKey: 'tenant-key',
    })
    expect(native.generate.mock.calls[0][1].modelSettings.maxOutputTokens).toBe(51)
    expect(await response.json()).toMatchObject({
      content: '价格 📈',
      tokens: { total: 5 },
      cost,
    })
  })
  it('returns only public completion/accounting fields and ignores unused Agent engine controls', async () => {
    native.generate.mockResolvedValue({
      ...result,
      request: { headers: { authorization: 'private-key' } },
      response: { body: 'private-diagnostic' },
      messages: [{ role: 'user', content: 'private-history' }],
      toolResults: [{ result: 'private-tool-output' }],
    })
    const response = await handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        tools: [{ id: 'forged-tool' }],
        stream: true,
        structuredOutput: { schema: { type: 'object' } },
      } as any,
      requestId: 'public-result',
    })
    expect(await response.json()).toEqual({
      content: result.text,
      model: 'openai/gpt-4.1',
      tokens: { prompt: 2, completion: 3, total: 5 },
      cost: { status: 'unavailable' },
    })
    expect(native.configurations[0]).not.toHaveProperty('tools')
    expect(native.generate.mock.calls[0][1]).not.toHaveProperty('structuredOutput')
  })

  it('retains completed native usage when generation fails', async () => {
    native.generate.mockRejectedValue(new Error('Native failure'))
    await expect(
      handleAIProviderRequest({
        body: { model: 'openai/gpt-4.1' },
        requestId: 'failed-generation',
      })
    ).rejects.toMatchObject({
      message: 'Native failure',
      model: 'openai/gpt-4.1',
      tokens: { total: 5 },
      cost: { status: 'unavailable' },
    })
  })
})

it('refuses an embedding model before generation admission or model contact', async () => {
  const model = 'openai/text-embedding-3-small'
  setManagedProviders({
    openai: {
      name: 'Controlled registered provider',
      url: 'https://not-contacted.invalid',
      models: ['text-embedding-3-small'],
    },
  })
  await expect(
    handleAIProviderRequest({
      body: { model, messages: [{ role: 'user', content: 'Generate a response' }] },
      requestId: 'embedding-rejected',
      authUserId: 'user-1',
    })
  ).rejects.toMatchObject({ status: 400 })
  expect(native.finance).not.toHaveBeenCalled()
  expect(native.generate).not.toHaveBeenCalled()
  expect(native.configurations).toEqual([])
  expect(native.usage).not.toHaveBeenCalled()
})
