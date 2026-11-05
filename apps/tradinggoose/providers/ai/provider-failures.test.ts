import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { Executor } from '@/executor'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import { anthropicProvider } from '@/providers/ai/anthropic'
import { bedrockProvider } from '@/providers/ai/bedrock'
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
