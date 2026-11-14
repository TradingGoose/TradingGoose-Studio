/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { managedServices, setManagedProviders } from '@/lib/mastra/__test-utils__/managed-services'
import { validateHallucination } from './validate_hallucination'

const native = vi.hoisted(() => ({
  realAgent: false,
  generate: vi.fn(),
  finance: vi.fn(),
  verify: vi.fn(),
  cost: vi.fn(),
  usage: vi.fn(),
}))
vi.mock('@/lib/mastra/usage-processors', () => ({ usageProcessors: native.finance }))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))
vi.mock('@mastra/core/agent', async (original) => {
  const actual = await original<typeof import('@mastra/core/agent')>()
  return {
    ...actual,
    Agent: class extends actual.Agent {
      generate(messages: any, options?: any): any {
        return native.realAgent
          ? super.generate(messages, options)
          : native.generate(messages, options)
      }
    },
  }
})
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'http://localhost:3000' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))
const input = {
  userInput: 'A claim',
  knowledgeBaseId: 'knowledge',
  threshold: 3,
  topK: 10,
  model: 'openai/gpt-4.1',
  requestId: 'run',
  userId: 'actor',
  workspaceId: 'workspace',
  authHeaders: new Headers({ authorization: 'Bearer internal' }),
}
const usage = { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
const searchAccounting = {
  cost: { status: 'unavailable', tokens: { prompt: 11, total: 11 }, model: 'native/embedding' },
  embeddingUsage: { status: 'reported', batches: 1 },
}
beforeEach(() => {
  managedServices.credentials.openai = { defaultApiKey: 'managed-fixture-key' }
  vi.clearAllMocks()
  native.realAgent = false
  native.cost.mockReset().mockReturnValue({ status: 'unavailable' })
  native.usage.mockReset().mockReturnValue(usage)
  native.finance.mockResolvedValue({
    inputProcessors: [],
    outputProcessors: [],
    getUsage: () => native.usage(),
    getCost: () => native.cost(),
    verifyComplete: native.verify,
  })
  native.verify.mockResolvedValue(undefined)
  native.generate.mockResolvedValue({
    object: { score: 8, reasoning: 'Supported' },
    finishReason: 'stop',
    totalUsage: usage,
  })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: { results: [{ content: 'Reference' }], ...searchAccounting } })
      )
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('hallucination search and scoring', () => {
  it.each([
    [{ score: 9, reasoning: 'Supported' }, true],
    [{ score: 9 }, false],
    [{ score: 11, reasoning: 'Outside score range' }, false],
  ] as const)(
    'validates %j through native Groq without requiring strict schemas',
    async (object, passed) => {
      native.realAgent = true
      const requests: any[] = []
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        if (String(url).endsWith('/api/knowledge/search'))
          return Response.json({ data: { results: [{ content: 'Reference' }] } })
        expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions')
        const body = JSON.parse(init!.body as string)
        requests.push(body)
        if (body.response_format?.json_schema?.strict)
          return Response.json(
            { error: { message: 'Strict schemas are unsupported' } },
            { status: 400 }
          )
        return Response.json({
          id: 'completion',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify(object) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
        })
      })
      const result = await validateHallucination({
        ...input,
        model: 'groq/openai/gpt-oss-safeguard-20b',
        apiKey: 'fixture-key',
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]).not.toHaveProperty('response_format')
      expect(result.passed).toBe(passed)
      if (passed) expect(result).toMatchObject(object)
      else expect(result.error).toBeTruthy()
    }
  )
  it('retains priced scorer cost when the search component has no reported cost', async () => {
    native.cost.mockReturnValue({
      total: 0.005,
      currency: 'USD',
      estimated: true,
      status: 'estimated',
    })
    const result = await validateHallucination(input)
    expect(result.cost).toMatchObject({
      status: 'partial',
      availableTotal: 0.005,
      estimated: true,
      currency: 'USD',
    })
    expect(result.cost?.total).toBeUndefined()
  })
  it('combines actual active usage while generic model USD remains unavailable', async () => {
    const result = await validateHallucination(input)
    expect(result).toMatchObject({
      passed: true,
      score: 8,
      tokens: { prompt: 14, completion: 2, total: 16 },
      embeddingUsage: searchAccounting.embeddingUsage,
    })
    expect(result.cost).toEqual({ status: 'unavailable' })
    expect(native.verify).toHaveBeenCalledOnce()
    expect(native.generate.mock.calls[0][1].tracingOptions.metadata).toEqual({
      runId: 'run',
      userId: 'actor',
      resourceId: 'workspace',
    })
    expect(native.generate.mock.calls[0][0][0].content).toContain('Reference')
  })
  it('shares authenticated actor and cancellation with financial gates and model', async () => {
    const signal = new AbortController().signal
    await validateHallucination({ ...input, signal })
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/knowledge/search')
    expect(options?.signal).toBe(signal)
    expect(options?.redirect).toBe('error')
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer internal')
    expect(native.finance.mock.calls[0][0]).toMatchObject({
      actorUserId: 'actor',
      workspaceId: 'workspace',
      runId: 'run',
      purpose: 'hallucination-scoring',
    })
    expect(native.finance.mock.calls[0][0].signal).toBe(
      native.generate.mock.calls[0][1].abortSignal
    )
  })
  it('does not fabricate absent scorer token fields or a dollar zero', async () => {
    native.usage.mockReturnValue({})
    native.generate.mockResolvedValue({ object: { score: 8 }, finishReason: 'stop' })
    const result = await validateHallucination(input)
    expect(result.tokens).toEqual({ prompt: 11, total: 11 })
    expect(result.cost).toEqual({ status: 'unavailable' })
  })
  it('preserves actual zero token fields without inventing model USD', async () => {
    native.usage.mockReturnValue({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    native.generate.mockResolvedValue({
      object: { score: 8 },
      finishReason: 'stop',
      totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })
    const result = await validateHallucination(input)
    expect(result.tokens).toEqual({ prompt: 11, completion: 0, total: 11 })
    expect(result.cost).toEqual({ status: 'unavailable' })
  })
  it('retains completed search when scoring fails before usage is available', async () => {
    native.usage.mockReturnValue({})
    native.generate.mockRejectedValue(new Error('Inference failed before response'))
    expect(await validateHallucination(input)).toMatchObject({
      passed: false,
      tokens: { prompt: 11, total: 11 },
      cost: { status: 'unavailable' },
      embeddingUsage: searchAccounting.embeddingUsage,
    })
    expect(native.verify).not.toHaveBeenCalled()
  })
  it('retains completed active scorer steps when a later model operation fails', async () => {
    native.generate.mockRejectedValue(new Error('Failure after a completed step'))
    expect(await validateHallucination(input)).toMatchObject({
      passed: false,
      tokens: { prompt: 14, completion: 2, total: 16 },
      cost: { status: 'unavailable' },
      embeddingUsage: searchAccounting.embeddingUsage,
    })
  })
  it('retains known active usage but refuses a seemingly valid aborted score', async () => {
    native.generate.mockResolvedValue({
      finishReason: 'aborted',
      object: { score: 8 },
      totalUsage: usage,
    })
    expect(await validateHallucination(input)).toMatchObject({
      passed: false,
      tokens: { prompt: 14, completion: 2, total: 16 },
      cost: { status: 'unavailable' },
    })
  })
  it('retains active usage while refusing incomplete financial acceptance', async () => {
    native.verify.mockRejectedValue(new Error('Financial acceptance unavailable'))
    expect(await validateHallucination(input)).toMatchObject({
      passed: false,
      tokens: { prompt: 14, completion: 2, total: 16 },
      cost: { status: 'unavailable' },
    })
  })
  it('retains completed search without a scoring contact when no context is found', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { results: [], ...searchAccounting } })
    )
    expect(await validateHallucination(input)).toMatchObject({
      passed: false,
      tokens: { prompt: 11, total: 11 },
      cost: { status: 'unavailable' },
      embeddingUsage: searchAccounting.embeddingUsage,
    })
    expect(native.generate).not.toHaveBeenCalled()
    expect(native.finance).not.toHaveBeenCalled()
  })
  it('retains available search usage after a vector-query HTTP failure', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(searchAccounting, { status: 500 }))
    expect(await validateHallucination(input)).toMatchObject({
      passed: false,
      tokens: { prompt: 11, total: 11 },
      cost: { status: 'unavailable' },
    })
    expect(native.generate).not.toHaveBeenCalled()
  })
  it('rejects empty input without search or model contact', async () => {
    expect(await validateHallucination({ ...input, userInput: ' ' })).toEqual({
      passed: false,
      error: 'User input is required',
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(native.generate).not.toHaveBeenCalled()
  })
  it('retains threshold behavior and known usage for a low-confidence score', async () => {
    native.generate.mockResolvedValue({
      object: { score: 2, reasoning: 'Unsupported' },
      finishReason: 'stop',
      totalUsage: usage,
    })
    expect(await validateHallucination(input)).toMatchObject({
      passed: false,
      score: 2,
      error: 'Low confidence: score 2/10 is below threshold 3',
      tokens: { total: 16 },
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
  const result = await validateHallucination({ ...input, model })
  expect(result).toMatchObject({
    passed: false,
    error: expect.stringContaining('Select a listed provider/model'),
    embeddingUsage: searchAccounting.embeddingUsage,
  })
  expect(native.finance).not.toHaveBeenCalled()
  expect(native.verify).not.toHaveBeenCalled()
  expect(native.generate).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledOnce()
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://localhost:3000/api/knowledge/search')
})
