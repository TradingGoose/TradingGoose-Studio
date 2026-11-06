import type { GenerateContentResponse } from '@google/genai'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { Executor } from '@/executor'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import { MAX_TOOL_ITERATIONS } from '@/providers/ai/constants'
import { toError } from '@/providers/ai/error'
import { googleProvider } from '@/providers/ai/google'
import type { ProviderRequest, ProviderToolConfig } from '@/providers/ai/types'
import * as providerUtils from '@/providers/ai/utils'
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

/** Queues matching native and nonstream SDK rounds without generating a second answer. */
function queueResponses(...responses: Partial<GenerateContentResponse>[]) {
  for (const response of responses) {
    mocks.generateContent.mockResolvedValueOnce(response)
    mocks.generateContentStream.mockResolvedValueOnce(
      (async function* () {
        yield response
      })()
    )
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.executeTool.mockResolvedValue({ success: true, output: { value: 42, cost: { total: 2 } } })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it.each(
  ['gemini-2.5-flash', 'gemini-3-flash-preview'].flatMap((model) =>
    ['unused', 'auto', 'forced'].map((mode) => ({ model, mode }))
  )
)('generates the native streamed $model answer once with $mode tools', async ({ model, mode }) => {
  const secondTool = { ...tool, id: 'second' }
  const tools =
    mode === 'forced'
      ? [tool, secondTool].map((entry) => ({ ...entry, usageControl: 'force' as const }))
      : [tool]
  const calls = mode === 'unused' ? [] : mode === 'forced' ? [call(), call('second')] : [call()]
  queueResponses(...calls, answer('Final'))
  const result = await googleProvider.executeRequest({
    model,
    apiKey: 'test-key',
    context: 'Analyze',
    tools,
    stream: true,
  })
  if (!('stream' in result)) throw new Error('Expected native streaming')
  expect(await new Response(result.stream).text()).toBe('Final')
  expect(mocks.generateContent).not.toHaveBeenCalled()
  expect(mocks.generateContentStream).toHaveBeenCalledTimes(calls.length + 1)
  expect(mocks.executeTool).toHaveBeenCalledTimes(calls.length)
  expect(result.execution.output).toMatchObject({
    content: 'Final',
    tokens: { input: (calls.length + 1) * 10, output: (calls.length + 1) * 5 },
    cost: { total: expect.any(Number) },
  })
  if (calls.length) {
    expect(result.execution.output.toolResults).toHaveLength(calls.length)
    expect(result.execution.output.cost?.toolCost).toBe(calls.length * 2)
    expect(mocks.generateContentStream.mock.calls[1][0].contents).toContainEqual(
      calls[0].candidates[0].content
    )
    expect(mocks.generateContentStream.mock.calls[1][0].contents.at(-2).parts[0]).toBe(
      calls[0].candidates[0].content.parts[0]
    )
  }
})

it('holds an automatic-tool answer until its no-call turn is classified, retaining accounting', async () => {
  let release!: () => void
  const completion = new Promise<void>((resolve) => {
    release = resolve
  })
  let waitingForCompletion!: () => void
  const waiting = new Promise<void>((resolve) => {
    waitingForCompletion = resolve
  })
  queueResponses(call())
  mocks.generateContentStream.mockImplementationOnce(async function* (
    _payload: Record<string, any>
  ) {
    yield answer('Visible ', 30)
    waitingForCompletion()
    await completion
    yield answer('answer', 30)
  })
  const result = await googleProvider.executeRequest({
    model: 'gemini-2.5-flash',
    apiKey: 'test-key',
    context: 'Analyze',
    tools: [tool],
    stream: true,
  })
  if (!('stream' in result)) throw new Error('Expected a streaming result')
  const reader = result.stream.getReader()
  let delivered = false
  const firstRead = reader.read().then((chunk) => {
    delivered = true
    return chunk
  })
  await waiting
  await Promise.resolve()
  try {
    expect(delivered).toBe(false)
  } finally {
    release()
  }
  const first = await firstRead
  expect(new TextDecoder().decode(first.value)).toBe('Visible ')
  expect(first.done).toBe(false)
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('answer')
  expect((await reader.read()).done).toBe(true)
  expect(mocks.generateContentStream).toHaveBeenCalledTimes(2)
  expect(mocks.generateContent).not.toHaveBeenCalled()
  const payload = mocks.generateContentStream.mock.calls[1][0]
  expect(payload.contents).toContainEqual(call().candidates[0].content)
  expect(result.execution.output).toMatchObject({
    content: 'Visible answer',
    tokens: { input: 40, output: 10, total: 50 },
    toolCalls: { count: 1 },
    cost: { toolCost: 2, total: expect.any(Number) },
    providerTiming: { iterations: 2 },
  })
  expect(result.execution.output.cost?.total).toBeGreaterThan(2)
})

it.each(['absent', 'filtered', 'NONE', 'schema-final'])(
  'streams native chunks immediately for a known non-tool turn: %s',
  async (mode) => {
    if (mode === 'NONE') {
      const prepareTools = providerUtils.prepareToolsWithUsageControl
      vi.spyOn(providerUtils, 'prepareToolsWithUsageControl').mockImplementationOnce((...args) => {
        const prepared = prepareTools(...args)
        prepared.toolConfig!.functionCallingConfig.mode = 'NONE'
        return prepared
      })
    }
    if (mode === 'schema-final') queueResponses(call())
    let release!: () => void
    let waitingForCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      release = resolve
    })
    const waiting = new Promise<void>((resolve) => {
      waitingForCompletion = resolve
    })
    const firstText = mode === 'schema-final' ? '{"value":' : 'Visible '
    const lastText = mode === 'schema-final' ? '42}' : 'answer'
    mocks.generateContentStream.mockImplementationOnce(async function* () {
      yield answer(firstText)
      waitingForCompletion()
      await completion
      yield answer(lastText)
    })
    const result = await googleProvider.executeRequest({
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
      context: 'Analyze',
      ...(mode !== 'absent' && {
        tools: [
          {
            ...tool,
            usageControl: mode === 'filtered' ? 'none' : mode === 'schema-final' ? 'force' : 'auto',
          },
        ],
      }),
      ...(mode === 'schema-final' && {
        responseFormat: { schema: { type: 'object', properties: { value: { type: 'number' } } } },
      }),
      stream: true,
    })
    if (!('stream' in result)) throw new Error('Expected native stream')
    const reader = result.stream.getReader()
    let delivered = false
    const firstRead = reader.read().then((chunk) => {
      delivered = true
      return chunk
    })
    await waiting
    await Promise.resolve()
    try {
      expect(delivered).toBe(true)
    } finally {
      release()
    }
    expect(new TextDecoder().decode((await firstRead).value)).toBe(firstText)
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(lastText)
    expect((await reader.read()).done).toBe(true)
    expect(result.execution.output.content).toBe(firstText + lastText)
    expect(mocks.generateContent).not.toHaveBeenCalled()
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(mode === 'schema-final' ? 2 : 1)
    expect(mocks.executeTool).toHaveBeenCalledTimes(mode === 'schema-final' ? 1 : 0)
    const payload = mocks.generateContentStream.mock.calls.at(-1)![0]
    if (mode === 'NONE') expect(payload.config.toolConfig.functionCallingConfig.mode).toBe('NONE')
    else expect(payload.config.tools).toBeUndefined()
  }
)

it.each([false, true])('synthesizes Gemini 2 JSON after auto tools, stream=%s', async (stream) => {
  const schema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }
  const settled = answer('The value is 42')
  queueResponses(call(), settled)
  mocks.generateContent.mockResolvedValueOnce(answer('{"value":42}'))
  mocks.generateContentStream.mockImplementationOnce(async function* (
    _payload: Record<string, any>
  ) {
    yield answer('{"value":')
    yield answer('42}')
  })
  const result = await googleProvider.executeRequest({
    model: 'gemini-2.5-flash',
    apiKey: 'test-key',
    context: 'Analyze',
    tools: [tool],
    responseFormat: { schema },
    stream,
  })
  const content = 'stream' in result ? await new Response(result.stream).text() : result.content
  expect(JSON.parse(content)).toEqual({ value: 42 })
  expect(mocks.generateContent).toHaveBeenCalledTimes(stream ? 0 : 3)
  expect(mocks.generateContentStream).toHaveBeenCalledTimes(stream ? 3 : 0)
  const payload = stream
    ? mocks.generateContentStream.mock.calls[2][0]
    : mocks.generateContent.mock.calls[2][0]
  expect(payload.config).toMatchObject({
    responseMimeType: 'application/json',
    responseSchema: schema,
  })
  expect(payload.config.tools).toBeUndefined()
  expect(payload.config.toolConfig).toBeUndefined()
  expect(payload.contents).toContainEqual(settled.candidates[0].content)
})

it.each([
  { model: 'gemini-2.5-flash', mode: 'unused', stream: true, generations: 2 },
  { model: 'gemini-2.5-flash', mode: 'forced', stream: true, generations: 2 },
  { model: 'gemini-3-flash-preview', mode: 'unused', stream: true, generations: 1 },
  { model: 'gemini-3-flash-preview', mode: 'auto', stream: true, generations: 2 },
  { model: 'gemini-3-flash-preview', mode: 'forced', stream: true, generations: 2 },
  { model: 'gemini-2.5-flash', mode: 'forced', stream: false, generations: 2 },
  { model: 'gemini-3-flash-preview', mode: 'auto', stream: false, generations: 2 },
  { model: 'gemini-2.5-flash', mode: 'disabled', stream: true, generations: 1 },
])(
  'generates $model JSON with $mode tools in $generations calls, stream=$stream',
  async ({ model, mode, stream, generations }) => {
    const schema = {
      type: 'object',
      properties: { value: { type: 'number' } },
      required: ['value'],
    }
    const responses: Partial<GenerateContentResponse>[] =
      mode === 'unused' || mode === 'disabled' ? [] : [call()]
    if (model === 'gemini-2.5-flash' && mode === 'unused') responses.push(answer('Draft'))
    responses.push(answer('{"value":42}'))
    queueResponses(...responses)
    const result = await googleProvider.executeRequest({
      model,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [
        {
          ...tool,
          usageControl: mode === 'forced' ? 'force' : mode === 'disabled' ? 'none' : 'auto',
        },
      ],
      responseFormat: { schema },
      stream,
    })
    const content = 'stream' in result ? await new Response(result.stream).text() : result.content
    expect(JSON.parse(content)).toEqual({ value: 42 })
    expect(mocks.generateContent).toHaveBeenCalledTimes(stream ? 0 : generations)
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(stream ? generations : 0)
    const payload = (stream ? mocks.generateContentStream : mocks.generateContent).mock.calls.at(
      -1
    )![0]
    expect(payload.config.responseMimeType).toBe('application/json')
    expect(
      payload.config[model === 'gemini-3-flash-preview' ? 'responseJsonSchema' : 'responseSchema']
    ).toEqual(schema)
  }
)

it.each([false, true])(
  'keeps mixed native tool-turn text out of Gemini 3 JSON, stream=%s',
  async (stream) => {
    const initial = call()
    const modelParts = [{ text: 'Checking the data.' }, ...initial.candidates[0].content.parts]
    queueResponses(
      {
        ...initial,
        text: 'Checking the data.',
        candidates: [
          { content: { role: 'model', parts: modelParts } },
          { content: { role: 'model', parts: [{ text: 'Unselected candidate' }] } },
        ],
      },
      answer('{"value":42}')
    )
    const result = await googleProvider.executeRequest({
      model: 'gemini-3-flash-preview',
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
      responseFormat: { schema: { type: 'object', properties: { value: { type: 'number' } } } },
      stream,
    })
    const content = 'stream' in result ? await new Response(result.stream).text() : result.content
    expect(JSON.parse(content)).toEqual({ value: 42 })
    const sdk = stream ? mocks.generateContentStream : mocks.generateContent
    expect(sdk).toHaveBeenCalledTimes(2)
    expect(sdk.mock.calls[1][0].contents.at(-2).parts).toEqual(modelParts)
    expect(mocks.executeTool).toHaveBeenCalledTimes(1)
  }
)

it.each(['missing', 'throws'])(
  'returns an all-%s tool batch to Gemini as error results',
  async (failure) => {
    const initial = call(failure === 'missing' ? 'unknown' : tool.id)
    if (failure === 'throws') mocks.executeTool.mockRejectedValueOnce(new Error('Unavailable'))
    queueResponses(initial, answer('Recovered'))
    const result = await googleProvider.executeRequest({
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
    })
    expect(result).toMatchObject({
      content: 'Recovered',
      toolCalls: [{ name: failure === 'missing' ? 'unknown' : tool.id, result: { error: true } }],
    })
    expect(mocks.executeTool).toHaveBeenCalledTimes(failure === 'missing' ? 0 : 1)
    expect(mocks.generateContent).toHaveBeenCalledTimes(2)
    expect(mocks.generateContent.mock.calls[1][0].contents.slice(-2)).toEqual([
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

it.each([false, true])(
  'retains completed Gemini usage and tool costs at the limit, stream=%s',
  async (stream) => {
    mocks.generateContent.mockResolvedValue(call())
    mocks.generateContentStream.mockImplementation(async function* () {
      yield call()
    })
    await expect(
      googleProvider
        .executeRequest({
          model: 'gemini-2.5-flash',
          apiKey: 'test-key',
          context: 'Analyze',
          tools: [tool],
          stream,
        })
        .then(async (result) => {
          if ('stream' in result) await new Response(result.stream).text()
          return result
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
    expect(mocks.generateContent).toHaveBeenCalledTimes(stream ? 0 : MAX_TOOL_ITERATIONS + 1)
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(stream ? MAX_TOOL_ITERATIONS + 1 : 0)
    expect(mocks.executeTool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
  }
)

it.each([false, true])(
  'preserves explicit failure accounting and timing, stream=%s',
  async (stream) => {
    const tokens = { input: 0, output: 0, total: 0 }
    const cost = { input: 0, output: 0, total: 0, pricing: null }
    const timing = { startTime: 'reported-start', endTime: 'reported-end', duration: 17 }
    const failure = toError(new TypeError('Reported failure'), {
      model: 'reported-model',
      tokens,
      cost,
      timing,
    })
    mocks.generateContent.mockResolvedValueOnce(call()).mockRejectedValueOnce(failure)
    mocks.generateContentStream
      .mockResolvedValueOnce(
        (async function* () {
          yield call()
        })()
      )
      .mockRejectedValueOnce(failure)
    const result = await googleProvider
      .executeRequest({
        model: 'gemini-2.5-flash',
        apiKey: 'test-key',
        context: 'Analyze',
        tools: [tool],
        stream,
      })
      .then(async (response) => {
        if ('stream' in response) await new Response(response.stream).text()
        return response
      })
      .catch(toError)
    expect(result).toBe(failure)
    expect(failure.model).toBe('reported-model')
    expect(failure.tokens).toBe(tokens)
    expect(failure.cost).toBe(cost)
    expect(failure.timing).toBe(timing)
    expect(mocks.executeTool).toHaveBeenCalledTimes(1)
  }
)

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
    const response = { ...call(), usageMetadata }
    if (stage === 'stream setup') {
      mocks.generateContentStream.mockResolvedValueOnce(
        (async function* () {
          yield response
        })()
      )
    } else mocks.generateContent.mockResolvedValueOnce(response)
  }
  if (stage === 'synthesis') {
    mocks.generateContent.mockResolvedValueOnce({ ...answer('Settled'), usageMetadata })
  }
  if (stage === 'stream setup') mocks.generateContentStream.mockRejectedValueOnce(failure)
  else mocks.generateContent.mockRejectedValueOnce(failure)

  const completedCalls = rounds + (stage === 'synthesis' ? 1 : 0)
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
    const error = await provider
      .executeRequest(failureRequest(model, stage))
      .then(async (result) => {
        if ('stream' in result) await new Response(result.stream).text()
        return result
      })
      .catch(toError)
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
      stage === 'stream setup' ? 0 : completedCalls + 1
    )
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(
      stage === 'stream setup' ? rounds + 1 : 0
    )
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

/** Builds an Agent route whose tool results or error are consumed by a real response block. */
function geminiWorkflow(model: string, recovery: boolean): SerializedWorkflow {
  const agent: SerializedBlock = {
    id: 'agent',
    metadata: { id: 'agent', name: 'Agent' },
    position: { x: 0, y: 0 },
    config: {
      tool: 'agent',
      params: {
        model,
        apiKey: 'test-key',
        userPrompt: 'Analyze',
        tools: [
          {
            type: 'custom-tool',
            title: 'Lookup',
            toolId: 'custom_lookup',
            schema: { function: { parameters: { type: 'object', properties: {} } } },
          },
        ],
      },
    },
    inputs: {},
    outputs: {},
    enabled: true,
  }
  return {
    version: '1.0',
    blocks: [
      {
        ...agent,
        id: 'start',
        metadata: { id: 'input_trigger', category: 'triggers' },
        config: { tool: 'input_trigger', params: {} },
      },
      agent,
      {
        ...agent,
        id: 'response',
        metadata: { id: 'response', name: 'Result' },
        config: {
          tool: 'response',
          params: {
            dataMode: 'json',
            data: recovery ? { error: '<agent.error>' } : { results: '<agent.toolResults>' },
          },
        },
      },
    ],
    connections: [
      { source: 'start', target: 'agent' },
      { source: 'agent', target: 'response', ...(recovery && { sourceHandle: 'error' }) },
    ],
    loops: {},
  }
}

it.each([
  { label: 'Google', model: 'gemini-3-flash-preview', structured: false },
  { label: 'Google', model: 'gemini-3-flash-preview', structured: true },
  { label: 'Vertex', model: 'vertex/gemini-3-flash-preview', structured: false },
  { label: 'Vertex', model: 'vertex/gemini-3-flash-preview', structured: true },
])(
  '$label excludes late-call text from real Agent output and billing, structured=$structured',
  async ({ model, structured }) => {
    vi.stubEnv('VERTEX_PROJECT', 'test-project')
    const signedCall = call('custom_lookup')
    const initialChunks: Partial<GenerateContentResponse>[] = [
      answer('Before '),
      answer('the lookup. '),
      signedCall,
      answer('After call. '),
    ]
    const initialParts = initialChunks.flatMap((chunk) => chunk.candidates![0].content!.parts!)
    mocks.generateContentStream
      .mockResolvedValueOnce(
        (async function* () {
          for (const chunk of initialChunks) yield chunk
        })()
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield answer(structured ? '{"value":"Final ' : 'Final ')
          yield answer(structured ? 'answer"}' : 'answer')
        })()
      )
    const workflow = geminiWorkflow(model, false)
    if (structured)
      workflow.blocks[1].config.params.responseFormat = {
        schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      }
    workflow.blocks[2].config.params.data = {
      answer: structured ? '<agent.value>' : '<agent.content>',
    }
    const events = vi.fn()
    const result = await new Executor({
      workflow,
      contextExtensions: {
        workspaceId: 'workspace',
        stream: true,
        selectedOutputs: ['agent'],
        onExecutionEvent: events,
      },
    }).execute('workflow', 'start')
    expect(result.success).toBe(true)
    const output = result.logs?.find((log) => log.blockId === 'agent')?.output
    expect(output).toMatchObject({
      ...(structured ? { value: 'Final answer' } : { content: 'Final answer' }),
      tokens: { total: 30 },
      cost: { toolCost: 2, total: expect.closeTo(2.00004, 10) },
    })
    const bytes = events.mock.calls
      .filter(([event]) => event.type === 'stream:chunk' && event.data.blockId === 'agent')
      .map(([event]) => event.data.chunk)
      .join('')
    expect(bytes).toBe(structured ? '{"value":"Final answer"}' : 'Final answer')
    expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
      response: { data: { answer: 'Final answer' } },
    })
    const history = mocks.generateContentStream.mock.calls[1][0].contents
    expect(history.at(-2).parts).toEqual(initialParts)
    expect(history.at(-2).parts[2]).toBe(signedCall.candidates[0].content.parts[0])
    expect(history.at(-1).parts[0].functionResponse).toMatchObject({
      name: 'custom_lookup',
      response: { value: 42 },
    })
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBeCloseTo(2.00004, 10)
    expect(billed.totalTokens).toBe(30)
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(2)
    expect(mocks.generateContent).not.toHaveBeenCalled()
    expect(mocks.executeTool).toHaveBeenCalledTimes(1)
  }
)

it.each([
  { stage: 'success', recovery: false },
  { stage: 'setup', recovery: false },
  { stage: 'setup', recovery: true },
  { stage: 'disconnect', recovery: false },
  { stage: 'disconnect', recovery: true },
])(
  'bills real streamed Gemini $stage once through Agent routing, recovery=$recovery',
  async ({ stage, recovery }) => {
    const failure = Object.assign(new TypeError('Native Gemini stream failed'), { status: 429 })
    let releaseDisconnect = () => {}
    const emitted = new Promise<void>((resolve) => {
      releaseDisconnect = resolve
    })
    let reachedHeldTurn!: () => void
    const heldTurn = new Promise<void>((resolve) => {
      reachedHeldTurn = resolve
    })
    mocks.generateContentStream.mockResolvedValueOnce(
      (async function* () {
        yield answer('Before tool. ')
        yield call('custom_lookup')
        yield answer('After tool call. ')
      })()
    )
    if (stage === 'setup') mocks.generateContentStream.mockRejectedValueOnce(failure)
    else
      mocks.generateContentStream.mockImplementationOnce(async function* () {
        yield answer(stage === 'success' ? 'Final answer' : 'Partial answer '.repeat(200))
        if (stage === 'disconnect') {
          reachedHeldTurn()
          await emitted
          throw failure
        }
      })
    const events = vi.fn()
    const execution = new Executor({
      workflow: geminiWorkflow('gemini-2.5-flash', recovery),
      contextExtensions: {
        workspaceId: 'workspace',
        stream: true,
        selectedOutputs: ['agent'],
        onExecutionEvent: events,
      },
    }).execute('workflow', 'start')
    if (stage === 'disconnect') {
      await heldTurn
      releaseDisconnect()
    }
    const result = await execution
    const rounds = stage === 'success' ? 2 : 1
    expect(result.success).toBe(stage === 'success' || recovery)
    const bytes = events.mock.calls
      .filter(([event]) => event.type === 'stream:chunk')
      .map(([event]) => event.data.chunk)
      .join('')
    expect(bytes).toBe(stage === 'success' ? 'Final answer' : '')
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: stage === 'success',
      output: {
        model: 'gemini-2.5-flash',
        tokens: { total: rounds * 15 },
        cost: { toolCost: 2, total: expect.closeTo(2 + rounds * 0.0000155, 10) },
      },
    })
    if (stage === 'success') {
      expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
        response: { data: { results: JSON.stringify([{ value: 42, cost: { total: 2 } }]) } },
      })
    } else {
      expect(failure.status).toBe(429)
      expect(failure.message).toBe('Native Gemini stream failed')
      expect(events.mock.calls.filter(([event]) => event.type === 'block:error')).toHaveLength(1)
      if (recovery)
        expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
          response: { data: { error: 'Native Gemini stream failed' } },
        })
    }
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBeCloseTo(2 + rounds * 0.0000155, 10)
    expect(billed.totalTokens).toBe(rounds * 15)
    expect(mocks.generateContent).not.toHaveBeenCalled()
    expect(mocks.generateContentStream).toHaveBeenCalledTimes(2)
    expect(mocks.executeTool).toHaveBeenCalledTimes(1)
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
    vi.spyOn(AgentBlockHandler.prototype, 'execute').mockImplementationOnce(async () => {
      const result = await provider.executeRequest(failureRequest(model, stage))
      if ('stream' in result) await new Response(result.stream).text()
      throw new Error('Expected Gemini failure')
    })
    const events = vi.fn()
    const result = await new Executor({
      workflow: geminiWorkflow(model, recovery),
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
