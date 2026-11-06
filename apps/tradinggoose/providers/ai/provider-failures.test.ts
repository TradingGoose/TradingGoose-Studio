import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { Executor } from '@/executor'
import { anthropicProvider } from '@/providers/ai/anthropic'
import { bedrockProvider } from '@/providers/ai/bedrock'
import { cerebrasProvider } from '@/providers/ai/cerebras'
import { MAX_TOOL_ITERATIONS } from '@/providers/ai/constants'
import { deepseekProvider } from '@/providers/ai/deepseek'
import { toError } from '@/providers/ai/error'
import { fireworksProvider } from '@/providers/ai/fireworks'
import { groqProvider } from '@/providers/ai/groq'
import { mistralProvider } from '@/providers/ai/mistral'
import { PROVIDER_DEFINITIONS, updateOpenRouterModels } from '@/providers/ai/models'
import { ollamaProvider } from '@/providers/ai/ollama'
import { openRouterProvider } from '@/providers/ai/openrouter'
import type { ProviderErrorDetails, ProviderToolConfig } from '@/providers/ai/types'
import { vllmProvider } from '@/providers/ai/vllm'
import { xAIProvider } from '@/providers/ai/xai'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  claude: vi.fn(),
  tool: vi.fn(),
  catalog: vi.fn(),
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.chat } }
  },
}))
vi.mock('groq-sdk', () => ({
  Groq: class {
    chat = { completions: { create: mocks.chat } }
  },
}))
vi.mock('@cerebras/cerebras_cloud_sdk', () => ({
  Cerebras: class {
    chat = { completions: { create: mocks.chat } }
  },
}))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: mocks.claude,
      stream: (payload: unknown) => ({ finalMessage: () => mocks.claude(payload) }),
    }
  },
}))
vi.mock('@/tools', () => ({ executeTool: mocks.tool }))
vi.mock('@/providers/ai/openrouter/models', () => ({ getOpenRouterModels: mocks.catalog }))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveOllamaServiceConfig: async () => ({ baseUrl: 'http://ollama:11434' }),
  resolveVllmServiceConfig: async () => ({ baseUrl: 'https://vllm.example' }),
}))

const tool: ProviderToolConfig = {
  id: 'lookup',
  name: 'Lookup',
  description: 'Look up data',
  params: {},
  parameters: { type: 'object', properties: {}, required: [] },
}
const toolCall = (id = 'call') => ({
  id,
  type: 'function',
  function: { name: tool.id, arguments: '{}' },
})
/** Builds one completed usage record, including native cache fields only when requested. */
function modelUsage(cachedTokens = 0) {
  return {
    prompt_tokens: 1000,
    completion_tokens: 500,
    total_tokens: 1500,
    ...(cachedTokens > 0 && {
      prompt_tokens_details: { cached_tokens: cachedTokens },
      prompt_cache_hit_tokens: cachedTokens,
    }),
  }
}

/** Builds a completed model round with usage and an optional pending lookup call. */
const completion = (pending = true, cachedTokens = 0) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: pending ? null : 'Done',
        ...(pending && { tool_calls: [toolCall()] }),
      },
      finish_reason: pending ? 'tool_calls' : 'stop',
    },
  ],
  usage: modelUsage(cachedTokens),
})

const openRouterModel = 'openrouter/publisher/reasoner'
const openRouterPricing = { input: 2, cachedInput: 0.5, output: 4 }
const originalOpenRouterModels = PROVIDER_DEFINITIONS.openrouter.models

const accountingProviders = [
  {
    label: 'Groq',
    provider: groqProvider,
    model: 'groq/openai/gpt-oss-120b',
    inputCost: 0.00012,
    outputCost: 0.0003,
  },
  {
    label: 'xAI',
    provider: xAIProvider,
    model: 'grok-4.5',
    inputCost: 0.00132,
    outputCost: 0.003,
  },
  {
    label: 'Cerebras',
    provider: cerebrasProvider,
    model: 'cerebras/gpt-oss-120b',
    inputCost: 0.00035,
    outputCost: 0.000375,
  },
  {
    label: 'OpenRouter',
    provider: openRouterProvider,
    model: openRouterModel,
    inputCost: 0.0014,
    outputCost: 0.002,
  },

  {
    label: 'DeepSeek',
    provider: deepseekProvider,
    model: 'deepseek-flash',
    inputCost: 0.0001824,
    outputCost: 0.0006,
  },
  {
    label: 'Fireworks',
    provider: fireworksProvider,
    model: 'fireworks/accounts/fireworks/models/glm-5p3',
    inputCost: 0.000944,
    outputCost: 0.0022,
  },
  {
    label: 'Mistral',
    provider: mistralProvider,
    model: 'mistral-large-4',
    inputCost: 0.000448,
    outputCost: 0.00105,
  },
  {
    label: 'Ollama',
    provider: ollamaProvider,
    model: 'ollama/custom',
    inputCost: 0,
    outputCost: 0,
  },
  { label: 'vLLM', provider: vllmProvider, model: 'vllm/custom', inputCost: 0, outputCost: 0 },
]
const nativeBatchProviders = accountingProviders.filter(
  ({ provider }) => provider.id !== 'openrouter'
)

/** Arranges a cached model response and completed tool before the next SDK call fails. */
function failOnContinuation(toolName = tool.id) {
  const error = Object.assign(new Error('Provider rate limit'), { status: 429, code: 'rate_limit' })
  const response = completion(true, 400)
  response.choices[0].message.tool_calls![0].function.name = toolName
  mocks.chat.mockResolvedValueOnce(response).mockRejectedValueOnce(error)
  return error
}

/** Runs actual tool rounds, then returns a text stream or rejects only its SDK setup call. */
function arrangePostToolStream(failure?: Error, toolName = tool.id) {
  let completedRounds = 0
  mocks.chat.mockImplementation(async (payload: { stream?: boolean }) => {
    if (payload.stream) {
      if (failure) throw failure
      return (async function* () {
        yield { choices: [{ delta: { content: 'Final ' } }] }
        yield { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }
        yield {
          choices: [],
          usage: modelUsage(400),
        }
      })()
    }
    const response = completion(completedRounds++ === 0, 400)
    if (response.choices[0].message.tool_calls) {
      response.choices[0].message.tool_calls[0].function.name = toolName
    }
    return response
  })
}

/** Supplies a rate-limit failure after the provider has completed its pre-stream work. */
function failOnStreamSetup(toolName = tool.id) {
  const error = Object.assign(new Error('Final stream setup rate limit'), {
    status: 429,
    code: 'rate_limit',
  })
  arrangePostToolStream(error, toolName)
  return error
}

/** Runs completed tool rounds and waits for emitted text before a stream disconnect. */
function arrangeAgentStream(failure?: Error) {
  let releaseDisconnect = () => {}
  const emitted = new Promise<void>((resolve) => {
    releaseDisconnect = resolve
  })
  let completedRounds = 0
  mocks.chat.mockImplementation(async (payload: { stream?: boolean }) => {
    if (!payload.stream) {
      const response = completion(completedRounds++ === 0)
      if (response.choices[0].message.tool_calls)
        response.choices[0].message.tool_calls[0].function.name = 'custom_lookup'
      return response
    }
    return (async function* () {
      yield {
        choices: [{ delta: { content: failure ? 'Partial answer '.repeat(200) : 'Final answer' } }],
      }
      if (failure) {
        await emitted
        throw failure
      }
      yield {
        choices: [],
        usage: modelUsage(),
      }
    })()
  })
  return releaseDisconnect
}

/** Builds a real Agent followed by a response resolving results or its recovery output. */
function toolAgentWorkflow(model: string, errorPath = false): SerializedWorkflow {
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
            data: errorPath
              ? { recovered: true, error: '<agent.error>', status: '<agent.status>' }
              : { results: '<agent.toolResults>' },
          },
        },
      },
    ],
    connections: [
      { source: 'start', target: 'agent' },
      { source: 'agent', target: 'response', ...(errorPath && { sourceHandle: 'error' }) },
    ],
    loops: {},
  }
}

/** Builds a native failed call without changing its raw arguments before model replay. */
function failingToolCall(kind: string, toolName = tool.id) {
  return {
    ...toolCall(kind),
    function: {
      name: kind === 'unknown' ? 'missing' : toolName,
      arguments: kind === 'malformed' ? '{' : JSON.stringify({ mode: kind }),
    },
  }
}

const openRouterReasoningDetails = Object.freeze([
  Object.freeze({ type: 'reasoning.text', text: 'Consider the data', signature: 'signed-text' }),
  Object.freeze({ type: 'reasoning.summary', summary: 'Use the tools', id: 'summary-1', index: 1 }),
  Object.freeze({ type: 'reasoning.encrypted', data: 'opaque-state', signature: 'signed-state' }),
])
const openRouterReasoningState = { reasoning_details: openRouterReasoningDetails }

/** Returns a cached tool round with native reasoning and unrelated metadata for whitelist checks. */
function openRouterBatchResponse(
  calls: ReturnType<typeof toolCall>[],
  reasoningState: Record<string, unknown> = openRouterReasoningState
) {
  const response = completion(true, 400)
  response.choices[0].message.tool_calls = calls
  response.choices[0].message.content = 'Calling tools'
  Object.assign(response.choices[0].message, reasoningState, {
    provider_metadata: { internal: 'not replayed' },
    reasoning_content: 'not a supported replay alias',
  })
  return response
}

/** Rejects missing, reordered or changed returned reasoning while keeping the replay whitelist narrow. */
function requireOpenRouterReasoningState(
  messages: any[],
  calls: ReturnType<typeof toolCall>[],
  reasoningState: Record<string, unknown>
) {
  const assistant = messages.find(
    /** Identifies the exact native assistant batch whose reasoning is required for continuation. */
    (message) =>
      message.role === 'assistant' && JSON.stringify(message.tool_calls) === JSON.stringify(calls)
  )
  expect(assistant).toEqual({
    role: 'assistant',
    content: 'Calling tools',
    tool_calls: calls,
    ...reasoningState,
  })
  for (const field of ['reasoning', 'reasoning_details']) {
    if (Object.hasOwn(reasoningState, field)) expect(assistant[field]).toBe(reasoningState[field])
    else expect(assistant).not.toHaveProperty(field)
  }
}

/** Requires one ordered result for every original call before the mocked model can recover. */
function hasNativeBatchResults(
  messages: any[],
  calls: ReturnType<typeof toolCall>[],
  failedIds: string[]
) {
  for (let index = 0; index < messages.length; index++) {
    const assistant = messages[index]
    if (
      assistant.role !== 'assistant' ||
      JSON.stringify(assistant.tool_calls) !== JSON.stringify(calls)
    )
      continue
    for (let callIndex = 0; callIndex < calls.length; callIndex++) {
      const call = calls[callIndex]
      const result = messages[index + callIndex + 1]
      if (result?.role !== 'tool' || result.tool_call_id !== call.id) return false
      const content = JSON.parse(result.content)
      if (failedIds.includes(call.id)) {
        if (content.error !== true || content.tool !== call.function.name) return false
      } else if (content.value !== 42) return false
    }
    return true
  }
  return false
}

/** Supplies thrown, returned-failure and paid successful outcomes to either native recovery harness. */
async function executeBatchTool(_name: string, args: { mode?: string }) {
  if (args.mode === 'thrown') throw new Error('Tool exploded')
  if (args.mode === 'returned') return { success: false, error: 'Tool refused' }
  return { success: true, output: { value: 42, cost: { total: 0.125 } } }
}

/** Allows recovery only after paired tool results and unchanged returned reasoning reach the model. */
function arrangeOpenRouterBatchRecovery(
  calls: ReturnType<typeof toolCall>[],
  failedIds: string[],
  reasoningState: Record<string, unknown> = openRouterReasoningState
) {
  const snapshots: any[] = []
  mocks.tool.mockImplementation(executeBatchTool)
  mocks.chat.mockImplementation(
    /** Repeats the pending batch until complete error feedback permits a final answer. */
    async (payload) => {
      const snapshot = JSON.parse(JSON.stringify(payload))
      snapshots.push(snapshot)
      if (!hasNativeBatchResults(snapshot.messages, calls, failedIds)) {
        return openRouterBatchResponse(calls, reasoningState)
      }
      requireOpenRouterReasoningState(payload.messages, calls, reasoningState)
      if (payload.stream) {
        return (async function* () {
          yield { choices: [{ delta: { content: 'Recovered' }, finish_reason: 'stop' }] }
          yield {
            choices: [],
            usage: modelUsage(400),
          }
        })()
      }
      return completion(false, 400)
    }
  )
  return snapshots
}

/** Returns failed and paid sibling calls without altering their native IDs or argument strings. */
function nativeBatchCalls(mixed: boolean, toolName = tool.id) {
  const failed = ['unknown', 'malformed', 'thrown', 'returned'].map((kind) =>
    failingToolCall(kind, toolName)
  )
  return mixed
    ? [
        failed[0],
        { ...toolCall('successful'), function: { name: toolName, arguments: '{}' } },
        ...failed.slice(1),
      ]
    : failed
}

/** Rejects invalid native call/result history instead of allowing an apparent successful recovery. */
function arrangeNativeBatchRecovery(calls: ReturnType<typeof toolCall>[], reasoning?: string) {
  const snapshots: any[] = []
  const failedIds = calls.filter((call) => call.id !== 'successful').map((call) => call.id)
  mocks.tool.mockImplementation(executeBatchTool)
  mocks.chat.mockImplementation(
    /** Requires a complete native assistant batch and ordered results before issuing the answer. */
    async (payload) => {
      snapshots.push(JSON.parse(JSON.stringify(payload)))
      if (snapshots.length === 1) {
        const response = completion()
        response.choices[0].message.tool_calls = calls
        if (reasoning !== undefined) Object.assign(response.choices[0].message, { reasoning })
        return response
      }
      if (!hasNativeBatchResults(payload.messages, calls, failedIds)) {
        throw new Error('Unpaired native tool history')
      }
      if (reasoning !== undefined) {
        const assistant = payload.messages.find(
          /** Locates the native assistant turn whose returned Groq reasoning must survive. */
          (message: any) =>
            message.role === 'assistant' && message.tool_calls?.[0]?.id === calls[0].id
        )
        expect(assistant.reasoning).toBe(reasoning)
      }
      if (payload.stream) {
        return (async function* () {
          yield { choices: [{ delta: { content: 'Recovered' }, finish_reason: 'stop' }] }
          yield {
            choices: [],
            usage: modelUsage(),
          }
        })()
      }
      return completion(false)
    }
  )
  return snapshots
}

const sharedFamilyProviders = [
  {
    label: 'Anthropic',
    provider: anthropicProvider,
    model: 'claude-sonnet-5-5',
    inputCost: 0.002,
    outputCost: 0.005,
  },
  {
    label: 'Bedrock',
    provider: bedrockProvider,
    model: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
    inputCost: 0.003,
    outputCost: 0.0075,
  },
]
const sharedFamilyFailurePaths = sharedFamilyProviders.flatMap(
  /** Exercises a stream setup boundary only in the family with an actual post-tool stream. */
  (entry) =>
    (entry.provider.id === 'bedrock' ? ['continuation', 'stream setup'] : ['continuation']).map(
      (phase) => ({ ...entry, phase })
    )
)

/** Fails a shared native family only after its model response and paid tool have completed. */
function arrangeSharedFamilyFailure(providerId: string, phase: string, toolName = tool.id) {
  const failure = Object.assign(new TypeError('Native family rate limit'), {
    status: 429,
    code: 'rate_limit',
    requestId: 'native-request',
  })
  if (providerId === 'anthropic') {
    mocks.claude
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'native-call', name: toolName, input: {} }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 1000, output_tokens: 500 },
      })
      .mockRejectedValueOnce(failure)
  } else {
    let completedRounds = 0
    vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation(
      /** Completes native tool and text rounds before rejecting the selected transport boundary. */
      async (command) => {
        if (
          command.constructor.name === 'ConverseStreamCommand' ||
          (phase === 'continuation' && completedRounds > 0)
        )
          throw failure
        const pending = completedRounds++ === 0
        return {
          output: {
            message: {
              role: 'assistant',
              content: pending
                ? [{ toolUse: { toolUseId: 'native-call', name: toolName, input: {} } }]
                : [{ text: 'Done' }],
            },
          },
          stopReason: pending ? 'tool_use' : 'end_turn',
          usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
        }
      }
    )
  }
  return failure
}

beforeEach(() => {
  vi.resetAllMocks()
  updateOpenRouterModels([openRouterModel], { [openRouterModel]: openRouterPricing })
  mocks.catalog.mockResolvedValue({
    models: [openRouterModel],
    pricing: { [openRouterModel]: openRouterPricing },
    capabilities: {},
  })
  mocks.chat.mockImplementation(async () => completion())
  mocks.claude.mockImplementation(async () => ({
    content: [{ type: 'tool_use', id: 'call', name: tool.id, input: {} }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1000, output_tokens: 500 },
  }))
  mocks.tool.mockResolvedValue({ success: true, output: { value: 42, cost: { total: 0.125 } } })
})
afterEach(() => {
  vi.restoreAllMocks()
  PROVIDER_DEFINITIONS.openrouter.models = originalOpenRouterModels
})

it('preserves the original error and completed usage through normalization', () => {
  const cost = { input: 1, output: 2, toolCost: 3, total: 6, pricing: null }
  const error = new TypeError('Provider failed')
  expect(toError(error, { model: 'gpt-4.1', cost })).toBe(error)
  expect(error).toMatchObject({ model: 'gpt-4.1', cost })
  expect(error).toBeInstanceOf(TypeError)

  const tokens = { prompt: 0, completion: 0, total: 0 }
  const zeroCost = { input: 0, output: 0, toolCost: 0, total: 0, pricing: null }
  Object.assign(error, { model: 'reported-model', tokens, cost: zeroCost })
  const details = { model: 'configured-model', tokens: { total: 30 }, cost }
  const savedDetails = structuredClone(details)
  expect(toError(error, details)).toBe(error)
  expect(toError(error).model).toBe('reported-model')
  expect(toError(error).tokens).toBe(tokens)
  expect(toError(error).cost).toBe(zeroCost)
  expect(details).toEqual(savedDetails)
})

const circularFailure: Record<string, unknown> = { message: 'Circular rejection', status: 429 }
circularFailure.self = circularFailure
const unstringifiableFailure: Record<string, unknown> = Object.create(null)
unstringifiableFailure.self = unstringifiableFailure

it.each([
  { label: 'ordinary string', value: 'Provider refused', message: 'Provider refused' },
  { label: 'empty string', value: '', message: '' },
  {
    label: 'serializable object',
    value: { message: 'Provider refused', status: 429 },
    message: '{"message":"Provider refused","status":429}',
  },
  { label: 'circular object', value: circularFailure, message: '[object Object]' },
  { label: 'BigInt object', value: { amount: 12n }, message: '[object Object]' },
  { label: 'BigInt primitive', value: 12n, message: '12' },
  { label: 'undefined', value: undefined, message: 'undefined' },
  { label: 'symbol', value: Symbol('provider failure'), message: 'Symbol(provider failure)' },
  { label: 'failed string coercion', value: unstringifiableFailure, message: 'Unknown error' },
])('keeps completed accounting through non-Error normalization: $label', ({ value, message }) => {
  const details: ProviderErrorDetails = {
    model: openRouterModel,
    tokens: { prompt: 20, completion: 10, total: 30 },
    cost: { input: 1, output: 1, toolCost: 2, total: 4, pricing: null },
  }
  const savedDetails = structuredClone(details)
  const error = toError(value, details)
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toBe(message)
  if (message !== '') expect(error.message.trim()).not.toBe('')
  expect(error).toMatchObject(details)
  expect(error.tokens).toBe(details.tokens)
  expect(error.cost).toBe(details.cost)
  expect(details).toEqual(savedDetails)
  expect(error).not.toHaveProperty('status')
})

it.each([false, true])(
  'bills a non-Error continuation through the real Agent once, recovery=%s',
  async (errorPath) => {
    const failure: Record<string, unknown> = { message: 'SDK rejected an object', status: 429 }
    failure.self = failure
    const round = completion(true, 400)
    round.choices[0].message.tool_calls![0].function.name = 'custom_lookup'
    mocks.chat.mockResolvedValueOnce(round).mockRejectedValueOnce(failure)
    const events = vi.fn()
    const result = await new Executor({
      workflow: toolAgentWorkflow(openRouterModel, errorPath),
      contextExtensions: { workspaceId: 'workspace', onExecutionEvent: events },
    }).execute('workflow', 'start')

    expect(result.success).toBe(errorPath)
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: false,
      output: {
        model: openRouterModel,
        tokens: { prompt: 1000, completion: 500, total: 1500 },
        cost: { input: 0.0014, output: 0.002, toolCost: 0.125, total: expect.closeTo(0.1284, 8) },
      },
    })
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'block:error',
        data: expect.objectContaining({
          error: '[object Object]',
          output: expect.objectContaining({ cost: expect.objectContaining({ toolCost: 0.125 }) }),
        }),
      })
    )
    if (errorPath) {
      expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
        response: { data: { recovered: true, error: '[object Object]' } },
      })
    } else {
      expect(result.error).toContain('[object Object]')
      expect(result.logs?.some((log) => log.blockId === 'response')).toBe(false)
    }
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBeCloseTo(0.1284, 8)
    expect(billed.totalInputCost).toBeCloseTo(0.0014, 8)
    expect(billed.totalOutputCost).toBeCloseTo(0.002, 8)
    expect(billed.totalTokens).toBe(1500)
    expect(failure.self).toBe(failure)
    expect(failure).not.toHaveProperty('tokens')
    expect(failure).not.toHaveProperty('cost')
    expect(mocks.tool).toHaveBeenCalledExactlyOnceWith('custom_lookup', expect.any(Object))
    expect(mocks.chat).toHaveBeenCalledTimes(2)
  }
)

it('resolves streamed Cerebras tool results downstream through the real Agent and Executor', async () => {
  arrangeAgentStream()
  const result = await new Executor({
    workflow: toolAgentWorkflow('cerebras/gpt-oss-120b'),
    contextExtensions: { workspaceId: 'workspace', stream: true, selectedOutputs: ['agent'] },
  }).execute('workflow', 'start')

  expect(result.success).toBe(true)
  expect(result.logs?.find((log) => log.blockId === 'agent')?.output).toMatchObject({
    content: 'Final answer',
    tokens: { prompt: 2000, completion: 1000, total: 3000 },
    toolResults: [{ value: 42, cost: { total: 0.125 } }],
    cost: { toolCost: 0.125, total: expect.closeTo(0.12645, 8) },
  })
  expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
    response: { data: { results: JSON.stringify([{ value: 42, cost: { total: 0.125 } }]) } },
  })
  const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
  expect(billed.totalCost).toBeCloseTo(0.12645, 8)
  expect(billed.totalTokens).toBe(3000)
  expect(mocks.chat).toHaveBeenCalledTimes(2)
  expect(mocks.tool).toHaveBeenCalledTimes(1)
})

it.each([false, true])(
  'bills accrued Cerebras usage once after an emitted stream disconnect, recovery=%s',
  async (errorPath) => {
    const failure = Object.assign(new Error('Provider disconnected'), { status: 503 })
    const releaseDisconnect = arrangeAgentStream(failure)
    const events = vi.fn(async (event) => {
      if (event.type === 'stream:chunk') releaseDisconnect()
    })
    const result = await new Executor({
      workflow: toolAgentWorkflow('cerebras/gpt-oss-120b', errorPath),
      contextExtensions: {
        workspaceId: 'workspace',
        stream: true,
        selectedOutputs: ['agent'],
        onExecutionEvent: events,
      },
    }).execute('workflow', 'start')

    expect(result.success).toBe(errorPath)
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: false,
      output: {
        model: 'cerebras/gpt-oss-120b',
        tokens: { prompt: 1000, completion: 500, total: 1500 },
        cost: { input: 0.00035, output: 0.000375, toolCost: 0.125, total: 0.125725 },
      },
    })
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stream:chunk',
        data: expect.objectContaining({ chunk: expect.stringContaining('Partial answer') }),
      })
    )
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'block:error',
        data: expect.objectContaining({
          output: expect.objectContaining({ cost: toError(failure).cost }),
        }),
      })
    )
    expect(failure.message).toBe('Provider disconnected')
    expect(failure.status).toBe(503)
    if (errorPath) {
      expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
        response: { data: { recovered: true, error: 'Provider disconnected', status: '503' } },
      })
    } else {
      expect(result.error).toContain('Provider disconnected')
      expect(result.logs?.some((log) => log.blockId === 'response')).toBe(false)
    }
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBeCloseTo(0.125725, 8)
    expect(billed.totalInputCost).toBeCloseTo(0.00035, 8)
    expect(billed.totalOutputCost).toBeCloseTo(0.000375, 8)
    expect(billed.totalTokens).toBe(1500)
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(['all', 'zero cost', 'zero tokens', 'model'] as const)(
  'preserves explicit disconnect metadata (%s) and fills only missing accounting fields',
  async (provided) => {
    const seededTokens = { prompt: 1000, completion: 500, total: 1500 }
    const suppliedTokens = { prompt: 0, completion: 0, total: 0 }
    const suppliedCost = { input: 0, output: 0, toolCost: 0, total: 0, pricing: null }
    const timing = { startTime: 'start', endTime: 'end', duration: 12 }
    const details: ProviderErrorDetails = {
      timing,
      ...((provided === 'all' || provided === 'model') && { model: 'reported-model' }),
      ...((provided === 'all' || provided === 'zero tokens') && { tokens: suppliedTokens }),
      ...((provided === 'all' || provided === 'zero cost') && { cost: suppliedCost }),
    }
    const failure = toError(new TypeError('Annotated disconnect'), details)
    const releaseDisconnect = arrangeAgentStream(failure)
    const result = await new Executor({
      workflow: toolAgentWorkflow('cerebras/gpt-oss-120b', true),
      contextExtensions: {
        workspaceId: 'workspace',
        stream: true,
        selectedOutputs: ['agent'],
        /** Emits text before disconnecting so explicit failure metadata takes precedence. */
        onExecutionEvent: async (event) => {
          if (event.type === 'stream:chunk') releaseDisconnect()
        },
      },
    }).execute('workflow', 'start')

    const output = result.logs?.find((log) => log.blockId === 'agent')?.output
    expect(result.success).toBe(true)
    expect(output).toMatchObject({
      model: details.model ?? 'cerebras/gpt-oss-120b',
      tokens: details.tokens ?? seededTokens,
      cost: details.cost ?? { total: 0.125725 },
    })
    expect(failure).toBeInstanceOf(TypeError)
    expect(failure.message).toBe('Annotated disconnect')
    expect(failure.timing).toBe(timing)
    if (details.tokens) expect(failure.tokens).toBe(suppliedTokens)
    if (details.cost) expect(failure.cost).toBe(suppliedCost)
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBeCloseTo(details.cost?.total ?? 0.125725, 8)
    expect(billed.totalTokens).toBe(details.tokens?.total ?? 1500)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it('uses the current streamed output accounting when metadata changes before a disconnect', async () => {
  const failure = new Error('Disconnect after usage update')
  const releaseDisconnect = arrangeAgentStream(failure)
  const tokens = { prompt: 2000, completion: 1000, total: 3000 }
  const cost = { input: 0.0007, output: 0.00075, toolCost: 0.125, total: 0.12645, pricing: null }
  const executeRequest = cerebrasProvider.executeRequest
  vi.spyOn(cerebrasProvider, 'executeRequest').mockImplementation(async (request) => {
    const result = await executeRequest(request)
    if (!('stream' in result)) throw new Error('Expected final stream')
    result.stream = result.stream.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          Object.assign(result.execution.output, { tokens, cost })
          controller.enqueue(chunk)
        },
      })
    )
    return result
  })
  const result = await new Executor({
    workflow: toolAgentWorkflow('cerebras/gpt-oss-120b', true),
    contextExtensions: {
      workspaceId: 'workspace',
      stream: true,
      selectedOutputs: ['agent'],
      /** Disconnects after emitted text and a usage update to exercise the latest snapshot. */
      onExecutionEvent: async (event) => {
        if (event.type === 'stream:chunk') releaseDisconnect()
      },
    },
  }).execute('workflow', 'start')

  expect(result.success).toBe(true)
  expect(result.logs?.find((log) => log.blockId === 'agent')?.output).toMatchObject({
    tokens,
    cost,
  })
  expect(toError(failure).tokens).toBe(tokens)
  expect(toError(failure).cost).toBe(cost)
  const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
  expect(billed.totalCost).toBeCloseTo(0.12645, 8)
  expect(billed.totalTokens).toBe(3000)
})

it('does not invent completed usage or tool charges for a direct-stream disconnect', async () => {
  const failure = new Error('Initial stream disconnected')
  const releaseDisconnect = arrangeAgentStream(failure)
  const workflow = toolAgentWorkflow('cerebras/gpt-oss-120b', true)
  workflow.blocks[1].config.params.tools = []
  const result = await new Executor({
    workflow,
    contextExtensions: {
      workspaceId: 'workspace',
      stream: true,
      selectedOutputs: ['agent'],
      /** Disconnects after initial text to verify that no completed usage is invented. */
      onExecutionEvent: async (event) => {
        if (event.type === 'stream:chunk') releaseDisconnect()
      },
    },
  }).execute('workflow', 'start')

  expect(result.success).toBe(true)
  expect(result.logs?.find((log) => log.blockId === 'agent')?.output).toMatchObject({
    tokens: { prompt: 0, completion: 0, total: 0 },
    cost: { total: 0 },
  })
  const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
  expect(billed.totalCost).toBe(0)
  expect(billed.totalTokens).toBe(0)
  expect(mocks.chat).toHaveBeenCalledTimes(1)
  expect(mocks.tool).not.toHaveBeenCalled()
})

it.each(accountingProviders)(
  '$label preserves cached usage and one completed tool charge on an ordinary continuation error',
  async ({ provider, model, inputCost, outputCost }) => {
    const failure = failOnContinuation()
    const error = await provider
      .executeRequest({ model, apiKey: 'test-key', context: 'Analyze', tools: [tool] })
      .catch(toError)

    expect(error).toBe(failure)
    expect(error).toMatchObject({
      status: 429,
      code: 'rate_limit',
      model,
      tokens: { total: 1500 },
      cost: { input: inputCost, output: outputCost, toolCost: 0.125 },
    })
    expect(toError(error).cost?.total).toBeCloseTo(inputCost + outputCost + 0.125, 8)
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(accountingProviders)(
  '$label preserves initial errors without inventing tokens or tool charges',
  async ({ provider, model }) => {
    const failure = Object.assign(new Error('Initial rate limit'), { status: 429 })
    mocks.chat.mockRejectedValueOnce(failure)
    const error = await provider
      .executeRequest({ model, apiKey: 'test-key', context: 'Analyze', tools: [tool] })
      .catch(toError)

    expect(error).toBe(failure)
    expect(error).toHaveProperty('status', 429)
    expect(toError(error).tokens?.total ?? 0).toBe(0)
    expect(toError(error).cost?.total ?? 0).toBe(0)
    expect(toError(error).cost?.toolCost ?? 0).toBe(0)
    if (provider.id === 'openrouter') {
      expect(toError(error).tokens).toBeUndefined()
      expect(toError(error).cost).toBeUndefined()
    }
    expect(mocks.chat).toHaveBeenCalledTimes(1)
    expect(mocks.tool).not.toHaveBeenCalled()
  }
)

it.each(accountingProviders)(
  '$label preserves cumulative paid usage when final stream SDK setup fails',
  async ({ provider, model, inputCost, outputCost }) => {
    const failure = failOnStreamSetup()
    const completedRounds = provider.id === 'cerebras' ? 1 : 2
    const error = await provider
      .executeRequest({
        model,
        apiKey: 'test-key',
        context: 'Analyze',
        tools: [tool],
        stream: true,
      })
      .catch(toError)

    expect(error).toBe(failure)
    expect(error).toMatchObject({
      status: 429,
      code: 'rate_limit',
      model,
      tokens: { total: completedRounds * 1500 },
      cost: {
        input: completedRounds * inputCost,
        output: completedRounds * outputCost,
        toolCost: 0.125,
      },
      timing: {
        startTime: expect.any(String),
        endTime: expect.any(String),
        duration: expect.any(Number),
      },
    })
    expect(toError(error).cost?.total).toBeCloseTo(
      completedRounds * (inputCost + outputCost) + 0.125,
      8
    )
    expect(toError(error).timing?.duration).toBeGreaterThanOrEqual(0)
    expect(mocks.chat).toHaveBeenCalledTimes(completedRounds + 1)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(
  accountingProviders.filter(({ provider }) =>
    ['groq', 'xai', 'cerebras', 'openrouter'].includes(provider.id)
  )
)(
  '$label preserves successful final stream accounting and request payloads',
  async ({ provider, model, inputCost, outputCost }) => {
    arrangePostToolStream()
    const completedRounds = provider.id === 'cerebras' ? 1 : 2
    const result = await provider.executeRequest({
      model,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
      stream: true,
    })
    if (!('stream' in result)) throw new Error('Expected final stream')
    expect(await new Response(result.stream).text()).toBe('Final answer')
    expect(result.execution.output).toMatchObject({
      model,
      content: 'Final answer',
      tokens: {
        prompt: (completedRounds + 1) * 1000,
        completion: (completedRounds + 1) * 500,
        total: (completedRounds + 1) * 1500,
      },
      cost: {
        input: (completedRounds + 1) * inputCost,
        output: (completedRounds + 1) * outputCost,
        toolCost: 0.125,
      },
    })
    expect(result.execution.output.cost?.total).toBeCloseTo(
      (completedRounds + 1) * (inputCost + outputCost) + 0.125,
      8
    )
    expect(mocks.chat).toHaveBeenCalledTimes(completedRounds + 1)
    expect(mocks.chat.mock.calls[0][0].tools).toHaveLength(1)
    const streamPayload = mocks.chat.mock.calls.at(-1)?.[0]
    expect(streamPayload).toMatchObject({ stream: true, messages: expect.any(Array) })
    if (provider.id === 'groq') {
      expect(streamPayload).not.toHaveProperty('tools')
      expect(streamPayload).not.toHaveProperty('tool_choice')
    } else {
      expect(streamPayload.tools).toHaveLength(1)
      expect(streamPayload.tool_choice).toBe(
        provider.id === 'cerebras' || provider.id === 'openrouter' ? 'none' : 'auto'
      )
    }
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(
  accountingProviders.flatMap((entry) =>
    [false, true].flatMap((errorPath) =>
      ['continuation', 'stream setup'].map((phase) => ({ ...entry, errorPath, phase }))
    )
  )
)(
  '$label bills an actual failed $phase once through the Executor, recovery=$errorPath',
  async ({ provider, model, inputCost, outputCost, errorPath, phase }) => {
    const stream = phase === 'stream setup'
    const toolName = 'custom_lookup'
    const failure = stream ? failOnStreamSetup(toolName) : failOnContinuation(toolName)
    const completedRounds = stream && provider.id !== 'cerebras' ? 2 : 1
    const events = vi.fn()
    const result = await new Executor({
      workflow: toolAgentWorkflow(model, errorPath),
      contextExtensions: {
        workspaceId: 'workspace',
        onExecutionEvent: events,
        ...(stream && { stream: true, selectedOutputs: ['agent'] }),
      },
    }).execute('workflow', 'start')

    expect(result.success).toBe(errorPath)
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: false,
      output: {
        model,
        tokens: { total: completedRounds * 1500 },
        cost: {
          input: completedRounds * inputCost,
          output: completedRounds * outputCost,
          toolCost: 0.125,
        },
      },
    })
    const { traceSpans } = buildTraceSpans(result)
    const billed = calculateCostSummary(traceSpans)
    expect(billed.totalCost).toBeCloseTo(completedRounds * (inputCost + outputCost) + 0.125, 8)
    expect(billed.totalInputCost).toBeCloseTo(completedRounds * inputCost, 8)
    expect(billed.totalOutputCost).toBeCloseTo(completedRounds * outputCost, 8)
    expect(billed.totalTokens).toBe(completedRounds * 1500)
    expect(
      events.mock.calls.some(
        ([event]) => event.type === 'block:error' && event.data.output?.cost?.toolCost === 0.125
      )
    ).toBe(true)
    expect(mocks.chat).toHaveBeenCalledTimes(completedRounds + 1)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
    expect(failure.status).toBe(429)
    expect(failure.code).toBe('rate_limit')
    if (errorPath) {
      expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
        response: { data: { recovered: true, error: failure.message, status: '429' } },
      })
    } else {
      expect(result.error).toContain(failure.message)
      expect(result.logs?.some((log) => log.blockId === 'response')).toBe(false)
    }
    expect(mocks.tool).toHaveBeenCalledExactlyOnceWith('custom_lookup', expect.any(Object))
    if (provider.id === 'openrouter') expect(mocks.catalog).toHaveBeenCalled()
  }
)

it('OpenRouter keeps the latest cached accounting after two paid rounds and a rejected continuation', async () => {
  const failure = Object.assign(new TypeError('Third request rate limit'), {
    status: 429,
    code: 'rate_limit',
    requestId: 'request-third',
  })
  for (const id of ['first', 'second']) {
    const response = completion(true, 400)
    response.choices[0].message.tool_calls![0].id = id
    mocks.chat.mockResolvedValueOnce(response)
  }
  mocks.chat.mockRejectedValueOnce(failure)
  const error = await openRouterProvider
    .executeRequest({
      model: openRouterModel,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
    })
    .catch(toError)

  expect(error).toBe(failure)
  expect(error).toMatchObject({
    status: 429,
    code: 'rate_limit',
    requestId: 'request-third',
    model: openRouterModel,
    tokens: { prompt: 2000, completion: 1000, total: 3000 },
    cost: { input: 0.0028, output: 0.004, toolCost: 0.25 },
    timing: {
      startTime: expect.any(String),
      endTime: expect.any(String),
      duration: expect.any(Number),
    },
  })
  expect(toError(error).cost?.total).toBeCloseTo(0.2568, 8)
  expect(mocks.chat).toHaveBeenCalledTimes(3)
  expect(mocks.tool).toHaveBeenCalledTimes(2)
})

it.each(['all', 'tokens', 'cost', 'model'] as const)(
  'OpenRouter preserves explicit error accounting (%s) while filling missing completed usage',
  async (provided) => {
    const tokens = { prompt: 0, completion: 0, total: 0 }
    const cost = { input: 0, output: 0, toolCost: 0, total: 0, pricing: null }
    const details: ProviderErrorDetails = {
      ...((provided === 'all' || provided === 'model') && { model: 'reported-model' }),
      ...((provided === 'all' || provided === 'tokens') && { tokens }),
      ...((provided === 'all' || provided === 'cost') && { cost }),
    }
    const failure = Object.assign(toError(new TypeError('Annotated continuation'), details), {
      status: 429,
      code: 'rate_limit',
      requestId: 'annotated-request',
    })
    const response = completion(true, 400)
    mocks.chat.mockResolvedValueOnce(response).mockRejectedValueOnce(failure)
    const error = await openRouterProvider
      .executeRequest({
        model: openRouterModel,
        apiKey: 'test-key',
        context: 'Analyze',
        tools: [tool],
      })
      .catch(toError)

    expect(error).toBe(failure)
    expect(error).toMatchObject({
      status: 429,
      code: 'rate_limit',
      requestId: 'annotated-request',
      model: details.model ?? openRouterModel,
      tokens: details.tokens ?? { prompt: 1000, completion: 500, total: 1500 },
      cost: details.cost ?? { input: 0.0014, output: 0.002, toolCost: 0.125 },
      timing: {
        startTime: expect.any(String),
        endTime: expect.any(String),
        duration: expect.any(Number),
      },
    })
    if (details.tokens) expect(toError(error).tokens).toBe(tokens)
    if (details.cost) expect(toError(error).cost).toBe(cost)
    expect(toError(error).cost?.total).toBeCloseTo(details.cost?.total ?? 0.1284, 8)
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each([
  { label: 'DeepSeek', provider: deepseekProvider, model: 'deepseek-flash' },
  { label: 'OpenRouter', provider: openRouterProvider, model: 'openrouter/test/model' },
  { label: 'Mistral', provider: mistralProvider, model: 'mistral-large-4' },
  {
    label: 'Fireworks',
    provider: fireworksProvider,
    model: 'fireworks/accounts/fireworks/models/glm-5p3',
  },
  { label: 'Groq', provider: groqProvider, model: 'groq/openai/gpt-oss-120b' },
  { label: 'Ollama', provider: ollamaProvider, model: 'ollama/custom' },
  { label: 'vLLM', provider: vllmProvider, model: 'vllm/custom' },
  { label: 'xAI', provider: xAIProvider, model: 'grok-4.5' },
  { label: 'Anthropic', provider: anthropicProvider, model: 'claude-sonnet-5-5' },
  {
    label: 'Bedrock',
    provider: bedrockProvider,
    model: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
  },
])(
  '$label retains completed rounds and tool cost when its iteration limit fails',
  async ({ label, provider, model }) => {
    vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation(async () => ({
      output: {
        message: {
          role: 'assistant',
          content: [{ toolUse: { toolUseId: 'call', name: tool.id, input: {} } }],
        },
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    }))
    const originalModels = PROVIDER_DEFINITIONS.openrouter.models
    updateOpenRouterModels(model.startsWith('openrouter/') ? [model] : [], {
      [model]: { input: 2, output: 4 },
    })
    try {
      const error = await provider
        .executeRequest({ model, apiKey: 'test-key', context: 'Analyze', tools: [tool] })
        .catch(toError)
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({
        message: expect.stringContaining(`${label} exceeded the tool iteration limit`),
        model,
        tokens: { total: (MAX_TOOL_ITERATIONS + 1) * 1500 },
        cost: { toolCost: MAX_TOOL_ITERATIONS * 0.125 },
      })
      const { cost } = toError(error)
      expect(cost?.total).toBeCloseTo(
        (cost?.input ?? 0) + (cost?.output ?? 0) + MAX_TOOL_ITERATIONS * 0.125
      )
      expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
    } finally {
      PROVIDER_DEFINITIONS.openrouter.models = originalModels
    }
  }
)

it.each([
  { provider: deepseekProvider, model: 'deepseek-flash' },
  { provider: mistralProvider, model: 'mistral-large-4' },
  { provider: fireworksProvider, model: 'fireworks/accounts/fireworks/models/glm-5p3' },
  { provider: groqProvider, model: 'groq/openai/gpt-oss-120b' },
])(
  '$provider.id keeps tools in tool rounds and removes them from its final stream',
  async ({ provider, model }) => {
    mocks.chat
      .mockResolvedValueOnce(completion())
      .mockResolvedValueOnce(completion(false))
      .mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }
          yield {
            choices: [],
            usage: modelUsage(),
          }
        })()
      )
    const result = await provider.executeRequest({
      model,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
      stream: true,
    })
    if (!('stream' in result)) throw new Error('Expected final stream')
    expect(await new Response(result.stream).text()).toBe('Done')
    expect(mocks.chat.mock.calls).toHaveLength(3)
    expect(mocks.chat.mock.calls[0][0].tools).toHaveLength(1)
    expect(mocks.chat.mock.calls[1][0].tools).toHaveLength(1)
    expect(mocks.chat.mock.calls[2][0]).not.toHaveProperty('tools')
    expect(mocks.chat.mock.calls[2][0]).not.toHaveProperty('tool_choice')
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(['auto', 'force'] as const)(
  'OpenRouter keeps prepared schemas and disables new calls in its final stream, usage=%s',
  async (usageControl) => {
    const model = 'openrouter/test/model'
    const originalModels = PROVIDER_DEFINITIONS.openrouter.models
    updateOpenRouterModels([model], { [model]: { input: 2, output: 4 } })
    const tools: ProviderToolConfig[] = [
      { ...tool, usageControl },
      {
        ...tool,
        id: 'unused',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      { ...tool, id: 'disabled', usageControl: 'none' },
    ]
    mocks.chat.mockResolvedValueOnce(completion()).mockResolvedValueOnce(completion(false))
    mocks.chat.mockImplementationOnce(async (payload) => {
      expect(payload.tools).toBe(mocks.chat.mock.calls[0][0].tools)
      expect(payload.tool_choice).toBe('none')
      return (async function* () {
        yield { choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }
        yield {
          choices: [],
          usage: modelUsage(),
        }
      })()
    })
    try {
      const result = await openRouterProvider.executeRequest({
        model,
        apiKey: 'test-key',
        context: 'Analyze',
        tools,
        stream: true,
      })
      if (!('stream' in result)) throw new Error('Expected final stream')
      expect(await new Response(result.stream).text()).toBe('Done')
      const [initial, continuation, final] = mocks.chat.mock.calls.map(([payload]) => payload)
      const schemas = tools.slice(0, 2).map(({ id, description, parameters }) => ({
        type: 'function',
        function: { name: id, description, parameters },
      }))
      for (const payload of [initial, continuation, final]) expect(payload.tools).toEqual(schemas)
      expect(initial.tool_choice).toEqual(
        usageControl === 'force' ? { type: 'function', function: { name: tool.id } } : 'auto'
      )
      expect(continuation.tool_choice).toBe('auto')
      expect(final).toMatchObject({
        tool_choice: 'none',
        stream: true,
        stream_options: { include_usage: true },
      })
      expect(final.messages).toBe(continuation.messages)
      expect(final.messages.slice(-2)).toEqual([
        { role: 'assistant', content: null, tool_calls: [toolCall()] },
        {
          role: 'tool',
          tool_call_id: 'call',
          content: JSON.stringify({ value: 42, cost: { total: 0.125 } }),
        },
      ])
      expect(result.execution.output).toMatchObject({
        content: 'Done',
        tokens: { prompt: 3000, completion: 1500, total: 4500 },
        cost: { input: 0.006, output: 0.006, toolCost: 0.125 },
      })
      expect(result.execution.output.cost?.total).toBeCloseTo(0.137, 8)
      expect(mocks.chat).toHaveBeenCalledTimes(3)
      expect(mocks.tool).toHaveBeenCalledExactlyOnceWith(tool.id, expect.any(Object))
    } finally {
      PROVIDER_DEFINITIONS.openrouter.models = originalModels
    }
  }
)

it.each(
  ['unknown', 'malformed', 'thrown', 'returned'].flatMap((kind) =>
    [false, true].map((stream) => ({ kind, stream }))
  )
)(
  'OpenRouter recovers from an all-failed $kind batch only after error feedback, stream=$stream',
  async ({ kind, stream }) => {
    const call = failingToolCall(kind)
    const snapshots = arrangeOpenRouterBatchRecovery([call], [call.id])
    const result = await openRouterProvider.executeRequest({
      model: openRouterModel,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
      stream,
    })
    const output = 'stream' in result ? result.execution.output : result
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Recovered')
    else expect(result.content).toBe('Done')

    const rounds = stream ? 3 : 2
    expect(output.tokens).toMatchObject({
      prompt: rounds * 1000,
      completion: rounds * 500,
      total: rounds * 1500,
    })
    expect(output.cost?.total).toBeCloseTo(rounds * 0.0034, 8)
    expect(output.cost?.toolCost ?? 0).toBe(0)
    expect(mocks.chat).toHaveBeenCalledTimes(rounds)
    expect(mocks.tool).toHaveBeenCalledTimes(kind === 'unknown' || kind === 'malformed' ? 0 : 1)
    const history = snapshots[1].messages.slice(-2)
    expect(history[0].tool_calls).toEqual([call])
    expect(history[1]).toMatchObject({ role: 'tool', tool_call_id: call.id })
    expect(JSON.parse(history[1].content)).toMatchObject({
      error: true,
      message: expect.any(String),
      tool: call.function.name,
    })
    if (stream) {
      expect(snapshots[2]).toMatchObject({ tool_choice: 'none', stream: true })
      expect(snapshots[2].tools).toEqual(snapshots[0].tools)
    }
  }
)

it('OpenRouter preserves one native mixed batch, successful siblings and ordered error results', async () => {
  const calls = [
    failingToolCall('unknown'),
    toolCall('successful'),
    failingToolCall('malformed'),
    failingToolCall('thrown'),
    failingToolCall('returned'),
  ]
  const snapshots = arrangeOpenRouterBatchRecovery(
    calls,
    calls.filter((call) => call.id !== 'successful').map((call) => call.id)
  )
  const result = await openRouterProvider.executeRequest({
    model: openRouterModel,
    apiKey: 'test-key',
    context: 'Analyze',
    tools: [tool],
  })
  if ('stream' in result) throw new Error('Expected completed response')
  expect(result.content).toBe('Done')
  expect(result.toolResults).toEqual([{ value: 42, cost: { total: 0.125 } }])
  expect(result.toolCalls).toContainEqual(
    expect.objectContaining({
      name: tool.id,
      success: true,
      result: { value: 42, cost: { total: 0.125 } },
    })
  )
  const history = snapshots[1].messages.slice(1)
  expect(history[0]).toEqual({
    role: 'assistant',
    content: 'Calling tools',
    tool_calls: calls,
    ...openRouterReasoningState,
  })
  expect(history.slice(1).map((message: any) => message.tool_call_id)).toEqual(
    calls.map((call) => call.id)
  )
  expect(JSON.parse(history[2].content)).toEqual({ value: 42, cost: { total: 0.125 } })
  expect(mocks.tool).toHaveBeenCalledTimes(3)
  expect(mocks.chat).toHaveBeenCalledTimes(2)
})

it.each(
  [
    { label: 'reasoning only', state: { reasoning: 'Plan before calling tools' } },
    { label: 'details only', state: openRouterReasoningState },
    {
      label: 'both fields',
      state: { reasoning: 'Plan and signed state', ...openRouterReasoningState },
    },
    { label: 'absent fields', state: {} },
    { label: 'empty reasoning', state: { reasoning: '' } },
    { label: 'empty details', state: { reasoning_details: [] } },
    { label: 'null fields', state: { reasoning: null, reasoning_details: null } },
  ].flatMap(({ label, state }) =>
    ['successful', 'all-failed', 'mixed'].map((batch) => ({ label, state, batch }))
  )
)(
  'OpenRouter preserves $label unchanged through a $batch tool continuation',
  async ({ state, batch }) => {
    const failed = failingToolCall('unknown')
    const successful = toolCall('successful')
    const calls =
      batch === 'successful'
        ? [successful]
        : batch === 'all-failed'
          ? [failed]
          : [failed, successful]
    const failedIds = batch === 'successful' ? [] : [failed.id]
    const savedState = JSON.parse(JSON.stringify(state))
    const snapshots = arrangeOpenRouterBatchRecovery(calls, failedIds, state)
    const result = await openRouterProvider.executeRequest({
      model: openRouterModel,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
    })
    if ('stream' in result) throw new Error('Expected completed response')
    expect(result.content).toBe('Done')
    expect(snapshots[1].messages[1]).toEqual({
      role: 'assistant',
      content: 'Calling tools',
      tool_calls: calls,
      ...savedState,
    })
    expect(state).toEqual(savedState)
    expect(result.tokens?.total).toBe(3000)
    expect(result.cost?.total).toBeCloseTo(0.0068, 8)
    expect(result.toolResults ?? []).toHaveLength(batch === 'all-failed' ? 0 : 1)
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(batch === 'all-failed' ? 0 : 1)
  }
)

it('OpenRouter advances a failed forced tool and keeps schemas with none for its recovered stream', async () => {
  const first = failingToolCall('malformed')
  const second = { ...toolCall('second'), function: { name: 'second', arguments: '{}' } }
  const firstReasoning = { reasoning: 'First tool rationale', ...openRouterReasoningState }
  const secondReasoning = Object.freeze({
    reasoning_details: Object.freeze([
      Object.freeze({ type: 'reasoning.encrypted', data: 'second-state', signature: 'second' }),
    ]),
  })
  const snapshots: any[] = []
  mocks.chat.mockImplementation(
    /** Advances the mocked model only after each forced call receives its native result. */
    async (payload) => {
      const snapshot = JSON.parse(JSON.stringify(payload))
      snapshots.push(snapshot)
      if (!hasNativeBatchResults(snapshot.messages, [first], [first.id])) {
        return openRouterBatchResponse([first], firstReasoning)
      }
      requireOpenRouterReasoningState(payload.messages, [first], firstReasoning)
      if (!hasNativeBatchResults(snapshot.messages, [second], [])) {
        return openRouterBatchResponse([second], secondReasoning)
      }
      requireOpenRouterReasoningState(payload.messages, [second], secondReasoning)
      if (payload.stream) {
        return (async function* () {
          yield { choices: [{ delta: { content: 'Recovered' }, finish_reason: 'stop' }] }
          yield {
            choices: [],
            usage: modelUsage(400),
          }
        })()
      }
      return completion(false, 400)
    }
  )
  const result = await openRouterProvider.executeRequest({
    model: openRouterModel,
    apiKey: 'test-key',
    context: 'Analyze',
    tools: [
      { ...tool, usageControl: 'force' },
      { ...tool, id: 'second', usageControl: 'force' },
    ],
    stream: true,
  })
  if (!('stream' in result)) throw new Error('Expected recovered stream')
  expect(await new Response(result.stream).text()).toBe('Recovered')
  expect(snapshots.map((payload) => payload.tool_choice)).toEqual([
    { type: 'function', function: { name: tool.id } },
    { type: 'function', function: { name: 'second' } },
    'auto',
    'none',
  ])
  expect(snapshots[3].tools).toEqual(snapshots[0].tools)
  expect(result.execution.output.tokens?.total).toBe(6000)
  expect(result.execution.output.cost?.total).toBeCloseTo(0.1386, 8)
  expect(mocks.chat).toHaveBeenCalledTimes(4)
  expect(mocks.tool).toHaveBeenCalledExactlyOnceWith('second', expect.any(Object))
})

it('OpenRouter bounds repeated failed batches while retaining completed cached usage without tool fees', async () => {
  const call = failingToolCall('unknown')
  const snapshots: any[] = []
  mocks.chat.mockImplementation(async (payload) => {
    snapshots.push(JSON.parse(JSON.stringify(payload)))
    return openRouterBatchResponse([call])
  })
  const error = await openRouterProvider
    .executeRequest({
      model: openRouterModel,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
    })
    .catch(toError)
  expect(error).toMatchObject({
    message: 'OpenRouter exceeded the tool iteration limit',
    tokens: { total: (MAX_TOOL_ITERATIONS + 1) * 1500 },
  })
  expect(toError(error).cost?.total).toBeCloseTo((MAX_TOOL_ITERATIONS + 1) * 0.0034, 8)
  expect(toError(error).cost?.toolCost ?? 0).toBe(0)
  expect(mocks.chat).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
  expect(mocks.tool).not.toHaveBeenCalled()
  expect(hasNativeBatchResults(snapshots[1].messages, [call], [call.id])).toBe(true)
  expect(snapshots.at(-1).messages.filter((message: any) => message.role === 'tool')).toHaveLength(
    MAX_TOOL_ITERATIONS
  )
})

it.each(['unknown', 'malformed', 'thrown', 'mixed'])(
  'OpenRouter model recovers from %s tool feedback before the Executor takes its error edge',
  async (kind) => {
    const failed = failingToolCall(kind === 'mixed' ? 'unknown' : kind, 'custom_lookup')
    const successful = {
      ...toolCall('successful'),
      function: { name: 'custom_lookup', arguments: '{}' },
    }
    const calls = kind === 'mixed' ? [failed, successful] : [failed]
    const snapshots = arrangeOpenRouterBatchRecovery(calls, [failed.id])
    const events = vi.fn()
    const result = await new Executor({
      workflow: toolAgentWorkflow(openRouterModel, true),
      contextExtensions: { workspaceId: 'workspace', onExecutionEvent: events },
    }).execute('workflow', 'start')

    expect(result.success).toBe(true)
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: true,
      output: { content: 'Done', tokens: { total: 3000 } },
    })
    expect(result.logs?.some((log) => log.blockId === 'response')).toBe(false)
    expect(events.mock.calls.some(([event]) => event.type === 'block:error')).toBe(false)
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBeCloseTo(0.0068 + (kind === 'mixed' ? 0.125 : 0), 8)
    expect(billed.totalTokens).toBe(3000)
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(kind === 'mixed' || kind === 'thrown' ? 1 : 0)
    expect(hasNativeBatchResults(snapshots[1].messages, calls, [failed.id])).toBe(true)
  }
)

it.each(
  nativeBatchProviders.flatMap((entry) => [false, true].map((mixed) => ({ ...entry, mixed })))
)(
  '$label recovers from failed native calls with one paired batch, mixed=$mixed',
  async ({ provider, model, mixed }) => {
    const calls = nativeBatchCalls(mixed)
    const snapshots = arrangeNativeBatchRecovery(calls)
    const result = await provider.executeRequest({
      model,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
    })
    if ('stream' in result) throw new Error('Expected completed response')
    expect(result.content).toBe('Done')
    expect(result.tokens?.total).toBe(3000)
    expect(result.toolResults ?? []).toEqual(mixed ? [{ value: 42, cost: { total: 0.125 } }] : [])
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(mixed ? 3 : 2)
    expect(
      hasNativeBatchResults(
        snapshots[1].messages,
        calls,
        calls.filter((call) => call.id !== 'successful').map((call) => call.id)
      )
    ).toBe(true)
  }
)

it.each(nativeBatchProviders)(
  '$label preserves paired mixed feedback and paid siblings in its final stream',
  async ({ provider, model }) => {
    const calls = nativeBatchCalls(true)
    const snapshots = arrangeNativeBatchRecovery(calls)
    const result = await provider.executeRequest({
      model,
      apiKey: 'test-key',
      context: 'Analyze',
      tools: [tool],
      stream: true,
    })
    if (!('stream' in result)) throw new Error('Expected final stream')
    expect(await new Response(result.stream).text()).toBe('Recovered')
    const completedRounds = provider.id === 'cerebras' ? 1 : 2
    expect(result.execution.output.tokens?.total).toBe((completedRounds + 1) * 1500)
    expect(result.execution.output.cost?.toolCost).toBe(0.125)
    expect(mocks.chat).toHaveBeenCalledTimes(completedRounds + 1)
    expect(mocks.tool).toHaveBeenCalledTimes(3)
    expect(
      hasNativeBatchResults(
        snapshots.at(-1).messages,
        calls,
        calls.filter((call) => call.id !== 'successful').map((call) => call.id)
      )
    ).toBe(true)
  }
)

it.each(nativeBatchProviders)(
  '$label recovers from paired tool errors through the real Agent and bills its paid sibling once',
  async ({ provider, model }) => {
    const calls = nativeBatchCalls(true, 'custom_lookup')
    arrangeNativeBatchRecovery(calls)
    const events = vi.fn()
    const result = await new Executor({
      workflow: toolAgentWorkflow(model, true),
      contextExtensions: { workspaceId: 'workspace', onExecutionEvent: events },
    }).execute('workflow', 'start')
    expect(result.success).toBe(true)
    const agent = result.logs?.find((log) => log.blockId === 'agent')
    expect(agent).toMatchObject({
      success: true,
      output: { content: 'Done', tokens: { total: 3000 }, cost: { toolCost: 0.125 } },
    })
    expect(result.logs?.some((log) => log.blockId === 'response')).toBe(false)
    expect(events.mock.calls.some(([event]) => event.type === 'block:error')).toBe(false)
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBeCloseTo(agent!.output!.cost!.total!, 8)
    expect(billed.totalTokens).toBe(3000)
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(3)
  }
)

it.each(nativeBatchProviders)(
  '$label preserves explicit zero accounting and original request metadata on continuation failure',
  async ({ provider, model }) => {
    const tokens = { prompt: 0, completion: 0, total: 0 }
    const cost = { input: 0, output: 0, toolCost: 0, total: 0, pricing: null }
    const timing = { startTime: 'reported-start', endTime: 'reported-end', duration: 7 }
    const failure = Object.assign(
      toError(new TypeError('Explicit accounting'), {
        model: 'reported-model',
        tokens,
        cost,
        timing,
      }),
      { status: 429, code: 'rate_limit', requestId: 'original-request' }
    )
    mocks.chat.mockResolvedValueOnce(completion()).mockRejectedValueOnce(failure)
    const error = await provider
      .executeRequest({ model, apiKey: 'test-key', context: 'Analyze', tools: [tool] })
      .catch(toError)
    expect(error).toBe(failure)
    expect(error).toMatchObject({
      status: 429,
      code: 'rate_limit',
      requestId: 'original-request',
      model: 'reported-model',
    })
    expect(toError(error).tokens).toBe(tokens)
    expect(toError(error).cost).toBe(cost)
    expect(toError(error).timing).toMatchObject({
      startTime: expect.any(String),
      endTime: expect.any(String),
      duration: expect.any(Number),
    })
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it('Cerebras pairs a suppressed duplicate signature without executing or charging it twice', async () => {
  const calls = [toolCall('successful'), toolCall('duplicate')]
  const snapshots = arrangeNativeBatchRecovery(calls)
  const result = await cerebrasProvider.executeRequest({
    model: 'cerebras/gpt-oss-120b',
    apiKey: 'test-key',
    context: 'Analyze',
    tools: [tool],
  })
  if ('stream' in result) throw new Error('Expected completed response')
  expect(result.content).toBe('Done')
  expect(result.toolResults).toEqual([{ value: 42, cost: { total: 0.125 } }])
  expect(mocks.tool).toHaveBeenCalledTimes(1)
  expect(mocks.chat).toHaveBeenCalledTimes(2)
  const history = snapshots[1].messages.slice(-3)
  expect(history[0].tool_calls).toEqual(calls)
  expect(history[1]).toMatchObject({ role: 'tool', tool_call_id: 'successful' })
  expect(history[2]).toMatchObject({ role: 'tool', tool_call_id: 'duplicate' })
  expect(JSON.parse(history[2].content)).toMatchObject({ error: true, tool: tool.id })
})

it('Groq replays its returned native reasoning unchanged while continuing a paid tool turn', async () => {
  const snapshots = arrangeNativeBatchRecovery([toolCall('successful')], 'Native Groq reasoning')
  const result = await groqProvider.executeRequest({
    model: 'groq/openai/gpt-oss-120b',
    apiKey: 'test-key',
    context: 'Analyze',
    tools: [tool],
  })
  if ('stream' in result) throw new Error('Expected completed response')
  expect(result.content).toBe('Done')
  expect(snapshots[1].messages.at(-2)).toMatchObject({ reasoning: 'Native Groq reasoning' })
})

it('Ollama retains cumulative paid streaming output through the real Agent and downstream results', async () => {
  arrangeAgentStream()
  const result = await new Executor({
    workflow: toolAgentWorkflow('ollama/custom'),
    contextExtensions: { workspaceId: 'workspace', stream: true, selectedOutputs: ['agent'] },
  }).execute('workflow', 'start')
  expect(result.success).toBe(true)
  expect(result.logs?.find((log) => log.blockId === 'agent')?.output).toMatchObject({
    content: 'Final answer',
    tokens: { prompt: 3000, completion: 1500, total: 4500 },
    cost: { input: 0, output: 0, toolCost: 0.125, total: 0.125 },
    toolResults: [{ value: 42, cost: { total: 0.125 } }],
  })
  expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
    response: { data: { results: JSON.stringify([{ value: 42, cost: { total: 0.125 } }]) } },
  })
  const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
  expect(billed.totalCost).toBe(0.125)
  expect(billed.totalTokens).toBe(4500)
  expect(mocks.chat).toHaveBeenCalledTimes(3)
  expect(mocks.tool).toHaveBeenCalledTimes(1)
})

it.each([false, true])(
  'Ollama retains completed paid usage after a stream disconnect, recovery=%s',
  async (errorPath) => {
    const failure = Object.assign(new Error('Ollama disconnected'), { status: 503 })
    const releaseDisconnect = arrangeAgentStream(failure)
    const result = await new Executor({
      workflow: toolAgentWorkflow('ollama/custom', errorPath),
      contextExtensions: {
        workspaceId: 'workspace',
        stream: true,
        selectedOutputs: ['agent'],
        /** Disconnects after emitted text so the canonical reader uses completed provider accounting. */
        onExecutionEvent: async (event) => {
          if (event.type === 'stream:chunk') releaseDisconnect()
        },
      },
    }).execute('workflow', 'start')
    expect(result.success).toBe(errorPath)
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: false,
      output: {
        model: 'ollama/custom',
        tokens: { total: 3000 },
        cost: { toolCost: 0.125, total: 0.125 },
      },
    })
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBe(0.125)
    expect(billed.totalTokens).toBe(3000)
    expect(failure.status).toBe(503)
    expect(failure.message).toBe('Ollama disconnected')
    if (errorPath)
      expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
        response: { data: { recovered: true, error: failure.message, status: '503' } },
      })
    else expect(result.error).toContain(failure.message)
    expect(mocks.chat).toHaveBeenCalledTimes(3)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(sharedFamilyFailurePaths)(
  '$label shared family retains completed accounting on $phase failure',
  async ({ provider, model, inputCost, outputCost, phase }) => {
    const failure = arrangeSharedFamilyFailure(provider.id, phase)
    const error = await provider
      .executeRequest({
        model,
        apiKey: 'test-key',
        context: 'Analyze',
        tools: [tool],
        stream: phase === 'stream setup',
      })
      .catch(toError)
    const rounds = phase === 'stream setup' ? 2 : 1
    expect(error).toBe(failure)
    expect(error).toMatchObject({
      model,
      status: 429,
      code: 'rate_limit',
      requestId: 'native-request',
      tokens: { total: rounds * 1500 },
      cost: { input: rounds * inputCost, output: rounds * outputCost, toolCost: 0.125 },
    })
    expect(toError(error).cost?.total).toBeCloseTo(rounds * (inputCost + outputCost) + 0.125, 8)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(
  sharedFamilyFailurePaths.flatMap((entry) =>
    [false, true].map((errorPath) => ({ ...entry, errorPath }))
  )
)(
  '$label shared family bills failed $phase through the real Agent, recovery=$errorPath',
  async ({ provider, model, inputCost, outputCost, phase, errorPath }) => {
    const failure = arrangeSharedFamilyFailure(provider.id, phase, 'custom_lookup')
    const stream = phase === 'stream setup'
    const result = await new Executor({
      workflow: toolAgentWorkflow(model, errorPath),
      contextExtensions: {
        workspaceId: 'workspace',
        ...(stream && { stream: true, selectedOutputs: ['agent'] }),
      },
    }).execute('workflow', 'start')
    const rounds = stream ? 2 : 1
    expect(result.success).toBe(errorPath)
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: false,
      output: {
        model,
        tokens: { total: rounds * 1500 },
        cost: {
          toolCost: 0.125,
          total: expect.closeTo(rounds * (inputCost + outputCost) + 0.125, 8),
        },
      },
    })
    const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
    expect(billed.totalCost).toBeCloseTo(rounds * (inputCost + outputCost) + 0.125, 8)
    expect(billed.totalTokens).toBe(rounds * 1500)
    expect(failure.status).toBe(429)
    expect(failure.requestId).toBe('native-request')
    if (errorPath)
      expect(result.logs?.find((log) => log.blockId === 'response')?.output).toMatchObject({
        response: { data: { recovered: true, error: failure.message, status: '429' } },
      })
    else expect(result.error).toContain(failure.message)
    expect(mocks.tool).toHaveBeenCalledExactlyOnceWith('custom_lookup', expect.any(Object))
  }
)

it.each(sharedFamilyProviders)(
  '$label shared family preserves initial failures without invented completed accounting',
  async ({ provider, model }) => {
    const failure = new TypeError('Native family initial failure')
    if (provider.id === 'anthropic') mocks.claude.mockRejectedValueOnce(failure)
    else vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockRejectedValueOnce(failure)
    const error = await provider
      .executeRequest({ model, apiKey: 'test-key', context: 'Analyze', tools: [tool] })
      .catch(toError)
    expect(error).toBe(failure)
    expect(toError(error).tokens).toBeUndefined()
    expect(toError(error).cost).toBeUndefined()
    expect(mocks.tool).not.toHaveBeenCalled()
  }
)

it.each(sharedFamilyProviders)(
  '$label shared family retains explicit accounting instead of replacing it with accrued usage',
  async ({ provider, model }) => {
    const failure = arrangeSharedFamilyFailure(provider.id, 'continuation')
    const tokens = { prompt: 0, completion: 0, total: 0 }
    const cost = { input: 0, output: 0, toolCost: 0, total: 0, pricing: null }
    toError(failure, { model: 'reported-model', tokens, cost })
    const error = await provider
      .executeRequest({ model, apiKey: 'test-key', context: 'Analyze', tools: [tool] })
      .catch(toError)
    expect(error).toBe(failure)
    expect(toError(error).model).toBe('reported-model')
    expect(toError(error).tokens).toBe(tokens)
    expect(toError(error).cost).toBe(cost)
    expect(failure.requestId).toBe('native-request')
  }
)
