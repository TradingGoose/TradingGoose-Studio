import type { GoogleGenAI } from '@google/genai'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { Executor } from '@/executor'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import { MAX_TOOL_ITERATIONS } from '@/providers/ai/constants'
import { toError } from '@/providers/ai/error'
import { executeGeminiRequest } from '@/providers/ai/gemini/core'
import { googleProvider } from '@/providers/ai/google'
import type { ProviderRequest, ProviderToolConfig } from '@/providers/ai/types'
import { vertexProvider } from '@/providers/ai/vertex'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mocks = vi.hoisted(() => ({
  executeTool: vi.fn(),
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
}))
vi.mock('@/tools', () => ({ executeTool: mocks.executeTool }))
vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = {
      generateContent: mocks.generateContent,
      generateContentStream: mocks.generateContentStream,
    }
  },
}))

const tool: ProviderToolConfig = {
  id: 'lookup',
  name: 'Lookup',
  description: 'Look up a value',
  params: {},
  parameters: { type: 'object', properties: {}, required: [] },
}
/** Creates an answer chunk with deterministic cumulative usage. */
const answer = (text: string, prompt = 10) => ({
  text,
  candidates: [{ content: { role: 'model', parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: 5, totalTokenCount: prompt + 5 },
})
/** Creates a signed tool-call response for continuation regressions. */
const call = (name = tool.id) => ({
  functionCalls: [{ name, args: {} }],
  candidates: [
    {
      content: {
        role: 'model',
        parts: [{ functionCall: { name, args: {} }, thoughtSignature: 'preserve-signature' }],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.executeTool.mockResolvedValue({ success: true, output: { value: 42, cost: { total: 2 } } })
})
afterEach(() => vi.restoreAllMocks())

it('delivers final Gemini answer chunks before generation completes and retains tool accounting', async () => {
  let release!: () => void
  const completion = new Promise<void>((resolve) => {
    release = resolve
  })
  const generateContent = vi
    .fn()
    .mockResolvedValueOnce(call())
    .mockResolvedValueOnce(answer('Settled answer', 20))
  const generateContentStream = vi.fn(async function* (_payload: Record<string, any>) {
    yield answer('Visible ', 30)
    await completion
    yield answer('answer', 30)
  })
  const result = await executeGeminiRequest({
    ai: { models: { generateContent, generateContentStream } } as unknown as GoogleGenAI,
    model: 'gemini-2.5-flash',
    providerType: 'google',
    request: { model: 'gemini-2.5-flash', context: 'Analyze', tools: [tool], stream: true },
  })
  if (!('stream' in result)) throw new Error('Expected a streaming result')
  expect(generateContentStream).toHaveBeenCalledTimes(1)
  expect(generateContent).toHaveBeenCalledTimes(2)
  const payload = generateContentStream.mock.calls[0][0]
  expect(payload.config.tools).toBeUndefined()
  expect(payload.config.toolConfig).toBeUndefined()
  expect(payload.contents).toContainEqual(answer('Settled answer', 20).candidates[0].content)

  const reader = result.stream.getReader()
  try {
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('Visible ')
    expect(first.done).toBe(false)
  } finally {
    release()
  }
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('answer')
  expect((await reader.read()).done).toBe(true)
  expect(result.execution.output).toMatchObject({
    content: 'Visible answer',
    tokens: { input: 60, output: 15, total: 75 },
    toolCalls: { count: 1 },
    cost: { toolCost: 2, total: expect.any(Number) },
    providerTiming: { iterations: 3 },
  })
  expect(result.execution.output.cost?.total).toBeGreaterThan(2)
})

it.each([false, true])('synthesizes Gemini 2 JSON after auto tools, stream=%s', async (stream) => {
  const schema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }
  const settled = answer('The value is 42')
  const generateContent = vi
    .fn()
    .mockResolvedValueOnce(call())
    .mockResolvedValueOnce(settled)
    .mockResolvedValueOnce(answer('{"value":42}'))
  const generateContentStream = vi.fn(async function* (_payload: Record<string, any>) {
    yield answer('{"value":')
    yield answer('42}')
  })
  const result = await executeGeminiRequest({
    ai: { models: { generateContent, generateContentStream } } as unknown as GoogleGenAI,
    model: 'gemini-2.5-flash',
    providerType: 'google',
    request: {
      model: 'gemini-2.5-flash',
      context: 'Analyze',
      tools: [tool],
      responseFormat: { schema },
      stream,
    },
  })
  const content = 'stream' in result ? await new Response(result.stream).text() : result.content
  expect(JSON.parse(content)).toEqual({ value: 42 })
  const payload = stream ? generateContentStream.mock.calls[0][0] : generateContent.mock.calls[2][0]
  expect(payload.config).toMatchObject({
    responseMimeType: 'application/json',
    responseSchema: schema,
  })
  expect(payload.config.tools).toBeUndefined()
  expect(payload.config.toolConfig).toBeUndefined()
  expect(payload.contents).toContainEqual(settled.candidates[0].content)
})

it.each(['missing', 'throws'])(
  'returns an all-%s tool batch to Gemini as error results',
  async (failure) => {
    const initial = call(failure === 'missing' ? 'unknown' : tool.id)
    if (failure === 'throws') mocks.executeTool.mockRejectedValueOnce(new Error('Unavailable'))
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(answer('Recovered'))
    const result = await executeGeminiRequest({
      ai: { models: { generateContent } } as unknown as GoogleGenAI,
      model: 'gemini-2.5-flash',
      providerType: 'google',
      request: { model: 'gemini-2.5-flash', context: 'Analyze', tools: [tool] },
    })
    expect(result).toMatchObject({
      content: 'Recovered',
      toolCalls: [{ name: failure === 'missing' ? 'unknown' : tool.id, result: { error: true } }],
    })
    expect(mocks.executeTool).toHaveBeenCalledTimes(failure === 'missing' ? 0 : 1)
    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(generateContent.mock.calls[1][0].contents.slice(-2)).toEqual([
      initial.candidates[0].content,
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: failure === 'missing' ? 'unknown' : tool.id,
              response: {
                error: true,
                message: expect.any(String),
                tool: failure === 'missing' ? 'unknown' : tool.id,
              },
            },
          },
        ],
      },
    ])
  }
)

it('retains completed Gemini usage and tool costs when pending calls exceed the limit', async () => {
  const generateContent = vi.fn().mockResolvedValue(call())
  await expect(
    executeGeminiRequest({
      ai: { models: { generateContent } } as unknown as GoogleGenAI,
      model: 'gemini-2.5-flash',
      providerType: 'google',
      request: { model: 'gemini-2.5-flash', context: 'Analyze', tools: [tool] },
    })
  ).rejects.toMatchObject({
    message: 'Gemini exceeded the tool iteration limit',
    model: 'gemini-2.5-flash',
    tokens: {
      input: (MAX_TOOL_ITERATIONS + 1) * 10,
      output: (MAX_TOOL_ITERATIONS + 1) * 5,
      total: (MAX_TOOL_ITERATIONS + 1) * 15,
    },
    cost: { toolCost: MAX_TOOL_ITERATIONS * 2 },
  })
  expect(generateContent).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
  expect(mocks.executeTool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
})

const failureStages = ['continuation', 'synthesis', 'stream setup'] as const
type FailureStage = (typeof failureStages)[number]
const routes = [
  { label: 'Google', provider: googleProvider, model: 'gemini-2.5-flash' },
  { label: 'Vertex', provider: vertexProvider, model: 'vertex/gemini-2.5-flash' },
]

/** Arranges real Gemini requests whose SDK continuation fails after completed tool rounds. */
function failAfterCompletedRounds(stage: FailureStage, rounds = 1, cached = false) {
  const failure = Object.assign(new TypeError('Gemini rate limit'), {
    status: 429,
    code: 'RESOURCE_EXHAUSTED',
    requestId: 'gemini-request',
  })
  const usageMetadata = {
    promptTokenCount: 10,
    candidatesTokenCount: 5,
    totalTokenCount: 15,
    cachedContentTokenCount: cached ? 4 : 0,
  }
  for (let round = 0; round < rounds; round++) {
    mocks.generateContent.mockResolvedValueOnce({ ...call(), usageMetadata })
  }
  if (stage !== 'continuation') {
    mocks.generateContent.mockResolvedValueOnce({ ...answer('Settled'), usageMetadata })
  }
  if (stage === 'stream setup') mocks.generateContentStream.mockRejectedValueOnce(failure)
  else mocks.generateContent.mockRejectedValueOnce(failure)

  const completedCalls = rounds + (stage === 'continuation' ? 0 : 1)
  return {
    failure,
    completedCalls,
    inputCost: completedCalls * (cached ? 0.00000192 : 0.000003),
    outputCost: completedCalls * 0.0000125,
    toolCost: rounds * 2,
  }
}

/** Configures the same failure phase through either public Gemini provider route. */
function failureRequest(model: string, stage: FailureStage): ProviderRequest {
  return {
    model,
    apiKey: 'test-key',
    vertexProject: 'test-project',
    context: 'Analyze',
    tools: [tool],
    ...(stage === 'synthesis' && {
      responseFormat: { schema: { type: 'object', properties: { value: { type: 'number' } } } },
    }),
    stream: stage === 'stream setup',
  }
}

it.each(
  routes.flatMap((route) =>
    failureStages.flatMap((stage) =>
      [1, 2].flatMap((rounds) =>
        [false, true].map((cached) => ({ ...route, stage, rounds, cached }))
      )
    )
  )
)(
  '$label retains completed Gemini costs after $stage failure, rounds=$rounds, cached=$cached',
  async ({ provider, model, stage, rounds, cached }) => {
    const { failure, completedCalls, inputCost, outputCost, toolCost } = failAfterCompletedRounds(
      stage,
      rounds,
      cached
    )
    const error = await provider.executeRequest(failureRequest(model, stage)).catch(toError)
    expect(error).toBe(failure)
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      requestId: 'gemini-request',
      model: 'gemini-2.5-flash',
      tokens: {
        input: completedCalls * 10,
        output: completedCalls * 5,
        total: completedCalls * 15,
      },
      cost: { toolCost },
      timing: {
        startTime: expect.any(String),
        endTime: expect.any(String),
        duration: expect.any(Number),
      },
    })
    const cost = toError(error).cost
    expect(cost?.input).toBeCloseTo(inputCost, 10)
    expect(cost?.output).toBeCloseTo(outputCost, 10)
    expect(cost?.total).toBeCloseTo(inputCost + outputCost + toolCost, 10)
    expect(mocks.executeTool).toHaveBeenCalledTimes(rounds)
    expect(mocks.generateContent).toHaveBeenCalledTimes(
      completedCalls + (stage === 'stream setup' ? 0 : 1)
    )
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(stage === 'stream setup' ? 1 : 0)
  }
)

it.each(routes)(
  '$label initial Gemini failure invents no usage or tool cost',
  async ({ provider, model }) => {
    const failure = Object.assign(new TypeError('Initial Gemini rate limit'), { status: 429 })
    mocks.generateContent.mockRejectedValueOnce(failure)
    const error = await provider
      .executeRequest(failureRequest(model, 'continuation'))
      .catch(toError)
    expect(error).toBe(failure)
    expect(toError(error).tokens?.total ?? 0).toBe(0)
    expect(toError(error).cost?.total ?? 0).toBe(0)
    expect(toError(error).cost?.toolCost ?? 0).toBe(0)
    expect(mocks.executeTool).not.toHaveBeenCalled()
  }
)

it.each(
  routes.flatMap((route) =>
    failureStages.flatMap((stage) =>
      [false, true].map((recovery) => ({ ...route, stage, recovery }))
    )
  )
)(
  '$label bills actual Gemini $stage failure once through executor logs, recovery=$recovery',
  async ({ provider, model, stage, recovery }) => {
    const { completedCalls, inputCost, outputCost, toolCost } = failAfterCompletedRounds(
      stage,
      1,
      true
    )
    vi.spyOn(AgentBlockHandler.prototype, 'execute')
      .mockImplementationOnce(async () => {
        await provider.executeRequest(failureRequest(model, stage))
        throw new Error('Expected Gemini failure')
      })
      .mockResolvedValue({ response: { content: 'Recovered' } })
    const agent: SerializedBlock = {
      id: 'agent',
      metadata: { id: 'agent', name: 'Agent' },
      position: { x: 0, y: 0 },
      config: { tool: 'agent', params: { model } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    const workflow: SerializedWorkflow = {
      version: '1.0',
      blocks: [
        {
          ...agent,
          id: 'start',
          metadata: { id: 'input_trigger', category: 'triggers' },
          config: { tool: 'input_trigger', params: {} },
        },
        agent,
        ...(recovery ? [{ ...agent, id: 'fallback' }] : []),
      ],
      connections: [
        { source: 'start', target: 'agent' },
        ...(recovery ? [{ source: 'agent', target: 'fallback', sourceHandle: 'error' }] : []),
      ],
      loops: {},
    }
    const events = vi.fn()
    const result = await new Executor({
      workflow,
      contextExtensions: { workspaceId: 'workspace', onExecutionEvent: events },
    }).execute('workflow', 'start')
    expect(result.success).toBe(recovery)
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: false,
      output: {
        model: 'gemini-2.5-flash',
        tokens: { total: completedCalls * 15 },
        cost: { input: inputCost, output: outputCost, toolCost },
      },
    })
    const { traceSpans } = buildTraceSpans(result)
    const billed = calculateCostSummary(traceSpans)
    expect(billed.totalCost).toBeCloseTo(inputCost + outputCost + toolCost, 10)
    expect(billed.totalInputCost).toBeCloseTo(inputCost, 10)
    expect(billed.totalOutputCost).toBeCloseTo(outputCost, 10)
    expect(billed.totalTokens).toBe(completedCalls * 15)
    expect(mocks.executeTool).toHaveBeenCalledTimes(1)
    expect(
      events.mock.calls.filter(
        ([event]) => event.type === 'block:error' && event.data.output?.cost?.toolCost === toolCost
      )
    ).toHaveLength(1)
  }
)
