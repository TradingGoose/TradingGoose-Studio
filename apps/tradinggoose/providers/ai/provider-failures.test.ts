import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { Executor } from '@/executor'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
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
import { ProviderError, type ProviderToolConfig } from '@/providers/ai/types'
import { vllmProvider } from '@/providers/ai/vllm'
import { xAIProvider } from '@/providers/ai/xai'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mocks = vi.hoisted(() => ({ chat: vi.fn(), claude: vi.fn(), tool: vi.fn() }))
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
const completion = (pending = true) => ({
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
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
})

const continuationProviders = [
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
]

/** Arranges a cached model response and completed tool before the next SDK call fails. */
function failOnContinuation() {
  const error = Object.assign(new Error('Provider rate limit'), { status: 429, code: 'rate_limit' })
  const response = completion()
  mocks.chat
    .mockResolvedValueOnce({
      ...response,
      usage: { ...response.usage, prompt_tokens_details: { cached_tokens: 400 } },
    })
    .mockRejectedValueOnce(error)
  return error
}

/** Runs actual tool rounds, then returns a text stream or rejects only its SDK setup call. */
function arrangePostToolStream(failure?: Error) {
  let completedRounds = 0
  mocks.chat.mockImplementation(async (payload: { stream?: boolean }) => {
    if (payload.stream) {
      if (failure) throw failure
      return (async function* () {
        yield { choices: [{ delta: { content: 'Final ' } }] }
        yield { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }
        yield {
          choices: [],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
            prompt_tokens_details: { cached_tokens: 400 },
          },
        }
      })()
    }
    const response = completion(completedRounds++ === 0)
    return {
      ...response,
      usage: { ...response.usage, prompt_tokens_details: { cached_tokens: 400 } },
    }
  })
}

/** Supplies a rate-limit failure after the provider has completed its pre-stream work. */
function failOnStreamSetup() {
  const error = Object.assign(new Error('Final stream setup rate limit'), {
    status: 429,
    code: 'rate_limit',
  })
  arrangePostToolStream(error)
  return error
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.chat.mockImplementation(async () => completion())
  mocks.claude.mockImplementation(async () => ({
    content: [{ type: 'tool_use', id: 'call', name: tool.id, input: {} }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1000, output_tokens: 500 },
  }))
  mocks.tool.mockResolvedValue({ success: true, output: { value: 42, cost: { total: 0.125 } } })
})
afterEach(() => vi.restoreAllMocks())

it('preserves the original error and completed usage through normalization and wrappers', () => {
  const cost = { input: 1, output: 2, toolCost: 3, total: 6, pricing: null }
  const error = new TypeError('Provider failed')
  expect(toError(error, { model: 'gpt-4.1', cost })).toBe(error)
  const wrapped = new ProviderError(
    'Provider failed',
    { startTime: '', endTime: '', duration: 1 },
    toError(error)
  )
  expect(wrapped).toMatchObject({ model: 'gpt-4.1', cost })
  expect(error).toBeInstanceOf(TypeError)
})

it.each(continuationProviders)(
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
      tokens: { prompt: 1000, completion: 500, total: 1500 },
      cost: { input: inputCost, output: outputCost, toolCost: 0.125 },
    })
    expect(toError(error).cost?.total).toBeCloseTo(inputCost + outputCost + 0.125, 8)
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(continuationProviders)(
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
    expect(mocks.chat).toHaveBeenCalledTimes(1)
    expect(mocks.tool).not.toHaveBeenCalled()
  }
)

it.each(continuationProviders)(
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
      tokens: {
        prompt: completedRounds * 1000,
        completion: completedRounds * 500,
        total: completedRounds * 1500,
      },
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

it.each(continuationProviders)(
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
      expect(streamPayload.tool_choice).toBe(provider.id === 'cerebras' ? 'none' : 'auto')
    }
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each(
  continuationProviders.flatMap((entry) =>
    [false, true].flatMap((errorPath) =>
      ['continuation', 'stream setup'].map((phase) => ({ ...entry, errorPath, phase }))
    )
  )
)(
  '$label bills an actual failed $phase once through the Executor, recovery=$errorPath',
  async ({ provider, model, inputCost, outputCost, errorPath, phase }) => {
    const stream = phase === 'stream setup'
    if (stream) failOnStreamSetup()
    else failOnContinuation()
    const completedRounds = stream && provider.id !== 'cerebras' ? 2 : 1
    vi.spyOn(AgentBlockHandler.prototype, 'execute')
      .mockImplementationOnce(async () => {
        await provider.executeRequest({
          model,
          apiKey: 'test-key',
          context: 'Analyze',
          tools: [tool],
          stream,
        })
        throw new Error('Expected provider continuation failure')
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
        ...(errorPath ? [{ ...agent, id: 'fallback' }] : []),
      ],
      connections: [
        { source: 'start', target: 'agent' },
        ...(errorPath ? [{ source: 'agent', target: 'fallback', sourceHandle: 'error' }] : []),
      ],
      loops: {},
    }
    const events = vi.fn()
    const result = await new Executor({
      workflow,
      contextExtensions: { workspaceId: 'workspace', onExecutionEvent: events },
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
  { provider: openRouterProvider, model: 'openrouter/test/model' },
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
            usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
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

it.each([false, true])(
  'keeps failed provider cost in executor logs and billing spans, errorPath=%s',
  async (errorPath) => {
    const cost = { input: 1, output: 2, toolCost: 0.5, total: 3.5, pricing: null }
    const failure = toError(new Error('Tool iteration limit'), {
      model: 'gpt-4.1',
      tokens: { prompt: 1000, completion: 500, total: 1500 },
      cost,
    })
    const execute = vi
      .spyOn(AgentBlockHandler.prototype, 'execute')
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ response: { content: 'Recovered' } })
    const agent: SerializedBlock = {
      id: 'agent',
      metadata: { id: 'agent', name: 'Agent' },
      position: { x: 0, y: 0 },
      config: { tool: 'agent', params: { model: 'gpt-4.1' } },
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
        ...(errorPath ? [{ ...agent, id: 'fallback' }] : []),
      ],
      connections: [
        { source: 'start', target: 'agent' },
        ...(errorPath ? [{ source: 'agent', target: 'fallback', sourceHandle: 'error' }] : []),
      ],
      loops: {},
    }
    const events = vi.fn()
    const result = await new Executor({
      workflow,
      contextExtensions: { workspaceId: 'workspace', onExecutionEvent: events },
    }).execute('workflow', 'start')
    expect(result.success).toBe(errorPath)
    expect(result.logs?.find((log) => log.blockId === 'agent')).toMatchObject({
      success: false,
      output: { model: 'gpt-4.1', cost, tokens: { total: 1500 } },
    })
    const { traceSpans } = buildTraceSpans(result)
    expect(traceSpans.flatMap((span) => [span, ...(span.children ?? [])])).toContainEqual(
      expect.objectContaining({ cost })
    )
    expect(
      events.mock.calls.some(
        ([event]) => event.type === 'block:error' && event.data.output?.cost === cost
      )
    ).toBe(true)
    expect(execute).toHaveBeenCalledTimes(errorPath ? 2 : 1)
  }
)
