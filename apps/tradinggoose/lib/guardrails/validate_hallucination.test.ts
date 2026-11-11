/** @vitest-environment node */
import { EMBEDDING_MODELS } from '@mastra/core/llm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateHallucination } from './validate_hallucination'

const native = vi.hoisted(() => ({ generate: vi.fn(), finance: vi.fn(), verify: vi.fn() }))
vi.mock('@/lib/mastra/usage-processors', () => ({ usageProcessors: native.finance }))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = native.generate
  },
}))
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
  vi.clearAllMocks()
  native.finance.mockResolvedValue({
    inputProcessors: [],
    outputProcessors: [],
    getUsage: () => ({}),
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
    native.generate.mockResolvedValue({ object: { score: 8 }, finishReason: 'stop' })
    const result = await validateHallucination(input)
    expect(result.tokens).toEqual({ prompt: 11, total: 11 })
    expect(result.cost).toEqual({ status: 'unavailable' })
  })
  it('preserves actual zero token fields without inventing model USD', async () => {
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
    native.generate.mockImplementation(
      async (_messages, options: { onStepFinish: (step: { usage: typeof usage }) => void }) => {
        options.onStepFinish({ usage })
        throw new Error('Failure after a completed step')
      }
    )
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
    expect(native.verify).not.toHaveBeenCalled()
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

it.each(EMBEDDING_MODELS.map(({ provider, id }) => [`${provider}/${id}`, provider, id] as const))(
  'refuses native-known embedding model %s before generation admission or model contact',
  async (model, provider, modelId) => {
    // Trusted deployment membership is explicit; purpose rejection uses real installed native metadata.
    vi.stubEnv(
      'MASTRA_MODEL_PROVIDERS',
      JSON.stringify({
        [provider]: {
          name: 'Controlled registered provider',
          url: 'https://not-contacted.invalid',
          models: [modelId],
        },
      })
    )
    try {
      const result = await validateHallucination({ ...input, model })
      expect(result).toMatchObject({
        passed: false,
        error: expect.stringContaining('Select a listed provider/model'),
        embeddingUsage: searchAccounting.embeddingUsage,
      })
      expect(native.finance).not.toHaveBeenCalled()
      expect(native.verify).not.toHaveBeenCalled()
      expect(native.generate).not.toHaveBeenCalled()
      // The existing authenticated KB search is a controlled earlier seam, not LLM contact.
      expect(fetch).toHaveBeenCalledOnce()
      expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://localhost:3000/api/knowledge/search')
    } finally {
      vi.unstubAllEnvs()
    }
  }
)
