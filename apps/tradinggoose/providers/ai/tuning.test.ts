import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ProviderId, ProviderRequest, ProviderToolConfig } from '@/providers/ai/types'

const mocks = vi.hoisted(() => ({
  openaiClient: vi.fn(),
  chat: vi.fn(),
  responses: vi.fn(),
  claude: vi.fn(),
  gemini: vi.fn(),
  tool: vi.fn(),
}))
vi.mock('openai', () => ({
  default: class {
    constructor(options: unknown) {
      mocks.openaiClient(options)
    }
    chat = { completions: { create: mocks.chat } }
    responses = { create: mocks.responses }
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
vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent: mocks.gemini, generateContentStream: mocks.gemini }
    interactions = { create: mocks.gemini }
  },
}))
vi.mock('@/tools', () => ({ executeTool: mocks.tool }))
vi.mock('@/lib/cache/server-json-cache', () => ({
  readServerJsonCache: async () => null,
  writeServerJsonCache: async () => {},
}))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureOpenAIServiceConfig: async () => ({ endpoint: 'https://example.openai.azure.com' }),
  resolveOllamaServiceConfig: async () => ({ baseUrl: 'http://ollama:11434' }),
  resolveVllmServiceConfig: async () => ({
    baseUrl: 'https://vllm.example',
    apiKey: 'system-vllm-key',
  }),
}))

import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { GET as discoverOllamaModels } from '@/app/api/providers/ai/ollama/models/route'
import { AgentBlock } from '@/blocks/blocks/agent'
import { getBlock } from '@/blocks/index'
import { Executor } from '@/executor'
import { executeProviderRequest } from '@/providers/ai'
import { anthropicProvider } from '@/providers/ai/anthropic'
import { azureAnthropicProvider } from '@/providers/ai/azure-anthropic'
import { MAX_TOOL_ITERATIONS } from '@/providers/ai/constants'
import { deepseekProvider } from '@/providers/ai/deepseek'
import { toError } from '@/providers/ai/error'
import { fireworksProvider } from '@/providers/ai/fireworks'
import { groqProvider } from '@/providers/ai/groq'
import { mistralProvider } from '@/providers/ai/mistral'
import { PROVIDER_DEFINITIONS, updateOpenRouterModels } from '@/providers/ai/models'
import { ollamaProvider } from '@/providers/ai/ollama'
import { openRouterProvider } from '@/providers/ai/openrouter'
import { vllmProvider } from '@/providers/ai/vllm'
import { xAIProvider } from '@/providers/ai/xai'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const request = (model: string, params: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model,
  apiKey: 'test-key',
  context: 'Analyze',
  ...params,
})
/** Builds a real Agent and response edge for tuning failures and accrued-usage billing. */
function tuningAgentWorkflow(
  params: Record<string, unknown>,
  errorPath = true
): SerializedWorkflow {
  const agent: SerializedBlock = {
    id: 'agent',
    metadata: { id: 'agent', name: 'Agent' },
    position: { x: 0, y: 0 },
    config: {
      tool: 'agent',
      params: { apiKey: 'test-key', userPrompt: 'Analyze', ...params },
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
        metadata: { id: 'response' },
        config: {
          tool: 'response',
          params: { dataMode: 'json', data: { error: '<agent.error>', status: '<agent.status>' } },
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

const tool: ProviderToolConfig = {
  id: 'lookup',
  name: 'Lookup',
  description: 'Look up data',
  params: {},
  parameters: { type: 'object', properties: {}, required: [] },
}
const toolCall = (id: string) => ({
  id,
  type: 'function' as const,
  function: { name: tool.id, arguments: '{}' },
})
const completion = (
  message = { role: 'assistant', content: 'Done' } as Record<string, unknown>,
  finishReason?: 'stop' | 'length' | 'tool_calls'
) => ({
  choices: [{ message, ...(finishReason ? { finish_reason: finishReason } : {}) }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
})
const response = (
  output: Record<string, unknown>[] = [
    { type: 'message', content: [{ type: 'output_text', text: 'Done' }] },
  ]
) => ({
  status: 'completed',
  output,
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
})
function respond(
  ...turns: Array<
    | ReturnType<typeof response>
    | ((payload: Record<string, unknown>) => ReturnType<typeof response>)
  >
) {
  mocks.responses.mockReset()
  for (const fixture of turns) {
    mocks.responses.mockImplementationOnce(async (payload) => {
      const turn = typeof fixture === 'function' ? fixture(payload) : fixture
      return payload.stream
        ? (async function* () {
            for (const item of turn.output) {
              if (item.type === 'message') {
                for (const part of item.content as { type: string; text: string }[]) {
                  yield { type: 'response.output_text.delta', delta: part.text }
                }
              }
            }
            yield { type: `response.${turn.status}`, response: turn }
          })()
        : turn
    })
  }
}
const history: ProviderRequest['messages'] = [
  { role: 'assistant', content: null, tool_calls: [toolCall('previous')] },
  { role: 'tool', content: '42', tool_call_id: 'previous' },
]
const controls = (payload: Record<string, unknown>) =>
  Object.fromEntries(
    ['max_tokens', 'max_completion_tokens', 'reasoning_effort', 'thinking', 'reasoning_format']
      .filter((key) => payload[key] !== undefined)
      .map((key) => [key, payload[key]])
  )

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      data: [
        {
          id: 'openai/gpt-4.1',
          pricing: {
            prompt: '0.000002',
            completion: '0.000008',
            input_cache_read: '0.0000005',
          },
        },
      ],
    })
  )
  mocks.chat.mockResolvedValue(completion())
  respond(response())
  mocks.claude.mockImplementation(async (payload) =>
    payload.stream
      ? (async function* () {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done' } }
        })()
      : { content: [{ type: 'text', text: 'Done' }], usage: { input_tokens: 10, output_tokens: 5 } }
  )
  mocks.tool.mockResolvedValue({ success: true, output: { value: 42 } })
})

it.each(
  ['cold', 'warm', 'unavailable', 'retry', 'missing', 'omitted'].flatMap((catalog) =>
    [true, false].flatMap((supported) =>
      ['literal', 'variable', 'environment', 'block'].flatMap((source) =>
        ['literal', 'references'].map((tuning) => ({ catalog, supported, source, tuning }))
      )
    )
  )
)(
  'resolves OpenRouter inputs after discovery: catalog=$catalog, supported=$supported, source=$source, tuning=$tuning',
  async ({ catalog, supported, source, tuning }) => {
    const originalModels = PROVIDER_DEFINITIONS.openrouter.models
    const model = 'openrouter/openai/gpt-4.1'
    const capabilities = {
      temperature: { min: 0, max: 2 },
      ...(supported && {
        reasoningEffort: { values: ['high'] },
        verbosity: { values: ['high'] },
      }),
    }
    const block: SerializedBlock = {
      id: 'agent',
      metadata: { id: 'agent' },
      position: { x: 0, y: 0 },
      config: {
        tool: 'agent',
        params: {
          temperature: tuning === 'references' ? '<variable.temperature>' : 0,
          reasoningEffort: supported
            ? tuning === 'references'
              ? '<variable.effort>'
              : 'high'
            : '{{REMOVED}}',
          verbosity: supported
            ? tuning === 'references'
              ? '{{VERBOSITY}}'
              : 'high'
            : '{{REMOVED}}',
          thinkingLevel: '{{REMOVED}}',
          model:
            source === 'variable'
              ? '<variable.model>'
              : source === 'environment'
                ? '{{MODEL}}'
                : source === 'block'
                  ? '<start.model>'
                  : model,
          apiKey: 'test-key',
          userPrompt: 'Analyze',
        },
      },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    const trigger: SerializedBlock = {
      ...block,
      id: 'start',
      metadata: { id: 'input_trigger', name: 'Start', category: 'triggers' },
      config: { tool: 'input_trigger', params: { model } },
    }
    const workflow: SerializedWorkflow = {
      version: '1.0',
      blocks: [trigger, block],
      connections: [{ source: 'start', target: 'agent' }],
      loops: {},
    }
    const configuredParams = structuredClone(block.config.params)

    try {
      updateOpenRouterModels(catalog === 'warm' ? [model] : [], undefined, {
        [model]: capabilities,
      })
      vi.mocked(getBlock).mockImplementation((type) => (type === 'agent' ? AgentBlock : undefined))
      if (catalog !== 'warm') {
        for (const subBlock of AgentBlock.subBlocks.filter((entry) => entry.id === 'temperature')) {
          expect(evaluateSubBlockConditionValues(subBlock.condition, { model })).toBe(false)
        }
      }
      let refreshCount = 0
      vi.mocked(fetch).mockImplementation(async () => {
        refreshCount++
        if (catalog === 'unavailable') throw new Error('Catalog unavailable')
        if (catalog === 'retry' && refreshCount === 1) throw new Error('Catalog unavailable')
        if (catalog === 'omitted' || (catalog === 'missing' && refreshCount === 1)) {
          return Response.json({ data: [] })
        }
        return Response.json({
          data: [
            {
              id: 'openai/gpt-4.1',
              supported_parameters: supported ? ['temperature', 'verbosity'] : ['temperature'],
              reasoning: { supported_efforts: supported ? ['high'] : [] },
            },
          ],
        })
      })
      const result = await new Executor({
        workflow,
        workflowInput: { model },
        envVarValues: { MODEL: model, VERBOSITY: 'high' },
        workflowVariables: {
          model: { name: 'model', type: 'plain', value: model },
          temperature: { name: 'temperature', type: 'number', value: '0' },
          effort: { name: 'effort', type: 'plain', value: 'high' },
        },
        contextExtensions: { workspaceId: 'workspace' },
      }).execute('workflow', 'start')
      if (catalog === 'unavailable' || catalog === 'omitted') {
        expect(result.success).toBe(false)
        expect(result.error).toContain(
          `Cannot apply configured controls without model capabilities: ${model}`
        )
        expect(mocks.chat).not.toHaveBeenCalled()
        expect(calculateCostSummary(buildTraceSpans(result).traceSpans)).toMatchObject({
          totalCost: 0,
          totalTokens: 0,
        })
        expect(refreshCount).toBe(2)
        expect(block.config.params).toEqual(configuredParams)
        return
      }
      expect(result.success, result.error).toBe(true)
      expect(mocks.chat).toHaveBeenCalledTimes(1)
      const payload = mocks.chat.mock.calls[0][0]
      expect(payload.temperature).toBe(0)
      expect(payload.reasoning_effort).toBe(supported ? 'high' : undefined)
      expect(payload.verbosity).toBe(supported ? 'high' : undefined)
      const inputs = result.logs?.find((log) => log.blockId === 'agent')?.input
      expect(inputs).toMatchObject({ model })
      expect(inputs).toHaveProperty('temperature', 0)
      expect(inputs).not.toHaveProperty('thinkingLevel')
      if (!supported) {
        expect(inputs).not.toHaveProperty('reasoningEffort')
        expect(inputs).not.toHaveProperty('verbosity')
      } else {
        expect(inputs).toHaveProperty('reasoningEffort', 'high')
        expect(inputs).toHaveProperty('verbosity', 'high')
      }
      expect(refreshCount).toBe(2)
      expect(block.config.params).toEqual(configuredParams)
    } finally {
      PROVIDER_DEFINITIONS.openrouter.models = originalModels
      vi.mocked(getBlock).mockReset()
    }
  }
)

it.each(['unavailable', 'omitted'] as const)(
  'checks explicitly configured OpenRouter controls when discovery remains %s',
  async (catalog) => {
    const originalModels = PROVIDER_DEFINITIONS.openrouter.models
    const model = 'openrouter/publisher/unknown'
    try {
      updateOpenRouterModels([])
      vi.mocked(fetch).mockImplementation(async () => {
        if (catalog === 'unavailable') throw new Error('Catalog unavailable')
        return Response.json({ data: [] })
      })
      for (const params of [
        { temperature: 0 },
        { reasoningEffort: 'high' },
        { verbosity: 'high' },
        { thinkingLevel: 'high' },
      ]) {
        await expect(executeProviderRequest('openrouter', request(model, params))).rejects.toThrow(
          `Cannot apply configured controls without model capabilities: ${model}`
        )
      }
      expect(mocks.chat).not.toHaveBeenCalled()
      for (const params of [
        {},
        { temperature: undefined, reasoningEffort: '', verbosity: '', thinkingLevel: '' },
      ]) {
        const result = await executeProviderRequest('openrouter', request(model, params))
        expect(result).toMatchObject({ content: 'Done', model })
      }
      expect(mocks.chat).toHaveBeenCalledTimes(2)
      expect(mocks.tool).not.toHaveBeenCalled()
    } finally {
      PROVIDER_DEFINITIONS.openrouter.models = originalModels
    }
  }
)

it('retains known OpenRouter tuning when refreshing an existing catalog fails', async () => {
  const originalModels = PROVIDER_DEFINITIONS.openrouter.models
  const model = 'openrouter/publisher/known'
  try {
    updateOpenRouterModels([model], undefined, {
      [model]: {
        temperature: { min: 0, max: 2 },
        reasoningEffort: { values: ['high'] },
        verbosity: { values: ['high'] },
      },
    })
    vi.mocked(fetch).mockRejectedValue(new Error('Catalog unavailable'))
    await executeProviderRequest(
      'openrouter',
      request(model, { temperature: 0, reasoningEffort: 'high', verbosity: 'high' })
    )
    expect(mocks.chat).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ temperature: 0, reasoning_effort: 'high', verbosity: 'high' })
    )
  } finally {
    PROVIDER_DEFINITIONS.openrouter.models = originalModels
  }
})

it('routes unknown OpenRouter tuning to the real Agent error edge without billing a default request', async () => {
  const originalModels = PROVIDER_DEFINITIONS.openrouter.models
  const model = 'openrouter/publisher/unknown'
  const workflow = tuningAgentWorkflow({ model, verbosity: '{{REMOVED}}' })
  const agent = workflow.blocks[1]
  try {
    updateOpenRouterModels([])
    vi.mocked(getBlock).mockImplementation((type) => (type === 'agent' ? AgentBlock : undefined))
    vi.mocked(fetch).mockRejectedValue(new Error('Catalog unavailable'))
    const result = await new Executor({
      workflow,
      contextExtensions: { workspaceId: 'workspace' },
    }).execute('workflow', 'start')
    const message = `Cannot apply configured controls without model capabilities: ${model}`
    expect(result.success, result.error).toBe(true)
    expect(result.logs?.find((entry) => entry.blockId === 'agent')).toMatchObject({
      success: false,
    })
    expect(result.logs?.find((entry) => entry.blockId === 'response')?.output).toMatchObject({
      response: { data: { error: message } },
    })
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(calculateCostSummary(buildTraceSpans(result).traceSpans)).toMatchObject({
      totalCost: 0,
      totalTokens: 0,
    })
    expect(agent.config.params.verbosity).toBe('{{REMOVED}}')
  } finally {
    PROVIDER_DEFINITIONS.openrouter.models = originalModels
    vi.mocked(getBlock).mockReset()
  }
})

it.each([false, true])(
  'retains completed Responses usage and original continuation errors, stream=%s',
  async (stream) => {
    const failure = Object.assign(new TypeError('Responses rate limit'), {
      status: 429,
      code: 'rate_limit',
      request_id: 'request-id',
    })
    respond(
      response([{ type: 'function_call', name: tool.id, call_id: 'paid', arguments: '{}' }]),
      () => {
        throw failure
      }
    )
    mocks.tool.mockResolvedValueOnce({ success: true, output: { cost: { total: 0.125 } } })
    const result = executeProviderRequest('openai', request('gpt-4.1', { stream, tools: [tool] }))
    if (stream) {
      const streaming = await result
      if (!('stream' in streaming)) throw new Error('Expected Responses stream')
      await expect(streaming.stream.getReader().read()).rejects.toBe(failure)
    } else {
      await expect(result).rejects.toBe(failure)
    }
    expect(failure).toMatchObject({
      model: 'gpt-4.1',
      status: 429,
      code: 'rate_limit',
      request_id: 'request-id',
      tokens: { prompt: 10, completion: 5, total: 15 },
      cost: { input: 0.00002, output: 0.00004, toolCost: 0.125, total: 0.12506 },
    })
    expect(failure).toBeInstanceOf(TypeError)
    expect(mocks.responses).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  }
)

it.each([false, true])(
  'preserves explicit zero Responses accounting on a failed continuation, stream=%s',
  async (stream) => {
    const tokens = { prompt: 0, completion: 0, total: 0 }
    const cost = { input: 0, output: 0, total: 0, pricing: null }
    const failure = toError(new Error('Reported failure'), { model: 'reported', tokens, cost })
    respond(
      response([{ type: 'function_call', name: tool.id, call_id: 'paid', arguments: '{}' }]),
      () => {
        throw failure
      }
    )
    mocks.tool.mockResolvedValueOnce({ success: true, output: { cost: { total: 0.125 } } })
    const result = executeProviderRequest('openai', request('gpt-4.1', { stream, tools: [tool] }))
    if (stream) {
      const streaming = await result
      if (!('stream' in streaming)) throw new Error('Expected Responses stream')
      await expect(streaming.stream.getReader().read()).rejects.toBe(failure)
    } else {
      await expect(result).rejects.toBe(failure)
    }
    expect(failure.model).toBe('reported')
    expect(failure.tokens).toBe(tokens)
    expect(failure.cost).toBe(cost)
  }
)

it.each([
  { model: 'gpt-4.1', stream: false, errorPath: false },
  { model: 'gpt-4.1', stream: true, errorPath: true },
  { model: 'azure/gpt-4.1', stream: false, errorPath: true },
  { model: 'azure/gpt-4.1', stream: true, errorPath: false },
])(
  'bills completed Responses usage through Agent routing: $model, stream=$stream, recovery=$errorPath',
  async ({ model, stream, errorPath }) => {
    const failure = Object.assign(new Error('Responses continuation failure'), { status: 429 })
    respond(
      response([
        { type: 'function_call', name: 'custom_lookup', call_id: 'paid', arguments: '{}' },
      ]),
      () => {
        throw failure
      }
    )
    mocks.tool.mockResolvedValueOnce({ success: true, output: { cost: { total: 0.125 } } })
    vi.mocked(getBlock).mockImplementation((type) => (type === 'agent' ? AgentBlock : undefined))
    try {
      const result = await new Executor({
        workflow: tuningAgentWorkflow(
          {
            model,
            tools: [
              {
                type: 'custom-tool',
                title: 'Lookup',
                toolId: 'custom_lookup',
                schema: { function: { parameters: { type: 'object', properties: {} } } },
              },
            ],
          },
          errorPath
        ),
        contextExtensions: { workspaceId: 'workspace', stream, selectedOutputs: ['agent'] },
      }).execute('workflow', 'start')
      expect(result.success).toBe(errorPath)
      expect(result.logs?.find((entry) => entry.blockId === 'agent')).toMatchObject({
        success: false,
        output: {
          model,
          tokens: { prompt: 10, completion: 5, total: 15 },
          cost: { toolCost: 0.125, total: expect.closeTo(0.12506, 8) },
        },
      })
      if (errorPath) {
        expect(result.logs?.find((entry) => entry.blockId === 'response')?.output).toMatchObject({
          response: { data: { error: failure.message, status: '429' } },
        })
      } else {
        expect(result.error).toContain(failure.message)
      }
      const billed = calculateCostSummary(buildTraceSpans(result).traceSpans)
      expect(billed.totalTokens).toBe(15)
      expect(billed.totalCost).toBeCloseTo(0.12506, 8)
      expect(mocks.responses).toHaveBeenCalledTimes(2)
      expect(mocks.tool).toHaveBeenCalledTimes(1)
    } finally {
      vi.mocked(getBlock).mockReset()
    }
  }
)

it('preserves an initial Responses error without inventing completed usage', async () => {
  const failure = Object.assign(new Error('Initial Responses failure'), { status: 429 })
  mocks.responses.mockReset().mockRejectedValueOnce(failure)
  await expect(executeProviderRequest('openai', request('gpt-4.1'))).rejects.toBe(failure)
  expect(failure).not.toHaveProperty('tokens')
  expect(failure).not.toHaveProperty('cost')
  expect(mocks.tool).not.toHaveBeenCalled()
})

it.each([
  [undefined, 'empty'],
  ['request-key', 'request-key'],
])('ignores the system vLLM key, request key=%s', async (apiKey, expected) => {
  await executeProviderRequest('vllm', request('vllm/custom-model', { apiKey }))
  expect(mocks.openaiClient).toHaveBeenCalledWith({
    apiKey: expected,
    baseURL: 'https://vllm.example/v1',
  })
})

it('streams Groq requests when every configured tool is disabled', async () => {
  mocks.chat.mockResolvedValueOnce(
    (async function* () {
      yield { choices: [{ delta: { content: 'Done' } }] }
      yield {
        choices: [],
        x_groq: { usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } },
      }
    })()
  )

  const result = await executeProviderRequest(
    'groq',
    request('groq/openai/gpt-oss-120b', {
      context: undefined,
      messages: [{ role: 'user', content: 'Analyze' }],
      stream: true,
      tools: [{ ...tool, usageControl: 'none' }],
    })
  )
  if (!('stream' in result)) throw new Error('Expected streaming execution')
  expect(await new Response(result.stream).text()).toBe('Done')
  expect(result.execution.output.tokens).toEqual({ prompt: 1000, completion: 500, total: 1500 })
  expect(result.execution.output.cost?.input).toBeCloseTo(0.00015, 8)
  expect(result.execution.output.cost?.output).toBeCloseTo(0.0003, 8)
  expect(result.execution.output.cost?.total).toBeCloseTo(0.00045, 8)
  expect(mocks.chat.mock.calls[0][0]).not.toHaveProperty('tools')
  expect(mocks.chat.mock.calls[0][0]).not.toHaveProperty('tool_choice')
})

it('sequences forced Groq tools before switching to automatic selection', async () => {
  const secondTool = { ...tool, id: 'second', name: 'Second' }
  mocks.chat
    .mockResolvedValueOnce(
      completion({ role: 'assistant', content: null, tool_calls: [toolCall('first')] })
    )
    .mockResolvedValueOnce(
      completion({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'second',
            type: 'function',
            function: { name: secondTool.id, arguments: '{}' },
          },
        ],
      })
    )
    .mockResolvedValueOnce(completion())

  await groqProvider.executeRequest(
    request('groq/openai/gpt-oss-120b', {
      tools: [
        { ...tool, usageControl: 'force' },
        { ...secondTool, usageControl: 'force' },
        { ...tool, id: 'disabled', usageControl: 'none' },
      ],
    })
  )

  expect(mocks.chat.mock.calls.map(([payload]) => payload.tool_choice)).toEqual([
    { type: 'function', function: { name: tool.id } },
    { type: 'function', function: { name: secondTool.id } },
    'auto',
  ])
  expect(mocks.chat.mock.calls[0][0].tools).toHaveLength(2)
  expect(mocks.tool).toHaveBeenCalledTimes(2)
})

it('sends system-only requests once through Claude and Bedrock SDK adapters', async () => {
  const systemPrompt = 'Analyze prices'
  await executeProviderRequest('anthropic', {
    model: 'claude-sonnet-5-5',
    apiKey: 'test-key',
    systemPrompt,
    maxTokens: 4096,
  })
  expect(mocks.claude).toHaveBeenCalledTimes(1)
  expect(mocks.claude.mock.calls[0][0]).toMatchObject({
    system: '',
    messages: [{ role: 'user', content: [{ type: 'text', text: systemPrompt }] }],
  })

  const send = vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation(async () => ({
    output: { message: { role: 'assistant', content: [{ text: 'Done' }] } },
    $metadata: {},
  }))
  try {
    await expect(
      executeProviderRequest('bedrock', {
        model: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
        systemPrompt,
      })
    ).resolves.toMatchObject({ content: 'Done' })
    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0][0]
    expect(command).toBeInstanceOf(ConverseCommand)
    expect(command.input).toMatchObject({
      system: undefined,
      messages: [{ role: 'user', content: [{ text: systemPrompt }] }],
    })
  } finally {
    send.mockRestore()
  }
})

it('retains paid tool costs in completed Azure Claude streaming requests', async () => {
  mocks.claude.mockResolvedValueOnce({
    content: [{ type: 'tool_use', id: 'paid-tool', name: tool.id, input: {} }],
    usage: { input_tokens: 10, output_tokens: 5 },
  })
  mocks.tool.mockResolvedValueOnce({ success: true, output: { cost: { total: 2 } } })

  const result = await executeProviderRequest(
    'azure-anthropic',
    request('azure-anthropic/claude-sonnet-4-5', {
      stream: true,
      maxTokens: 4096,
      tools: [tool],
      azureEndpoint: 'https://example.services.ai.azure.com',
    })
  )

  expect(mocks.claude).toHaveBeenCalledTimes(2)
  expect(mocks.tool).toHaveBeenCalledTimes(1)
  if ('stream' in result) throw new Error('Expected completed response')
  expect(result.content).toBe('Done')
  expect(result.cost?.toolCost).toBe(2)
  expect(result.cost?.total).toBeCloseTo(2.00021, 8)
})

it.each([
  ['xai', 'grok-4.7', 110000, 2, 6],
  ['mistral', 'mistral-large-4', 10000, 0.7, 2.1],
  ['anthropic', 'claude-haiku-5-5', 60000, 0.1, 0.5],
  ['azure-anthropic', 'azure-anthropic/claude-haiku-5-5', 60000, 0.1, 0.5],
] as const)(
  'prices each %s tool-loop call before adding paid tool costs',
  async (provider, model, inputTokens, inputRate, outputRate) => {
    if (provider.includes('anthropic')) {
      const usage = { input_tokens: inputTokens, output_tokens: 100 }
      mocks.claude
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'paid-tool', name: tool.id, input: {} }],
          usage,
        })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Done' }], usage })
    } else {
      const usage = {
        prompt_tokens: inputTokens,
        completion_tokens: 100,
        total_tokens: inputTokens + 100,
      }
      mocks.chat
        .mockResolvedValueOnce({ ...completion({ tool_calls: [toolCall('paid-tool')] }), usage })
        .mockResolvedValueOnce({ ...completion(), usage })
    }
    mocks.tool.mockResolvedValueOnce({ success: true, output: { cost: { total: 2 } } })

    const result = await executeProviderRequest(
      provider,
      request(model, {
        context: undefined,
        messages: [{ role: 'user', content: 'Analyze' }],
        maxTokens: 1000,
        tools: [tool],
        azureEndpoint: 'https://example.services.ai.azure.com',
      })
    )
    if ('stream' in result) throw new Error('Expected completed response')
    expect(result.tokens).toMatchObject({ prompt: inputTokens * 2, completion: 200 })
    expect(result.cost?.input).toBeCloseTo((inputTokens * 2 * inputRate) / 1e6, 8)
    expect(result.cost?.output).toBeCloseTo((200 * outputRate) / 1e6, 8)
    expect(result.cost?.toolCost).toBe(2)
    expect(result.cost?.total).toBeCloseTo(
      2 + (inputTokens * 2 * inputRate + 200 * outputRate) / 1e6,
      8
    )
  }
)

it.each([
  ['xai', 'grok-4.7', 110000, 2, 6],
  ['mistral', 'mistral-large-4', 10000, 0.7, 2.1],
] as const)(
  'retains %s tool-loop usage and costs when its final answer streams',
  async (provider, model, inputTokens, inputRate, outputRate) => {
    const usage = {
      prompt_tokens: inputTokens,
      completion_tokens: 100,
      total_tokens: inputTokens + 100,
    }
    mocks.chat
      .mockResolvedValueOnce({ ...completion({ tool_calls: [toolCall('paid-tool')] }), usage })
      .mockResolvedValueOnce({ ...completion(), usage })
      .mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: 'Final answer' } }] }
          yield { choices: [], usage }
        })()
      )
    mocks.tool.mockResolvedValueOnce({ success: true, output: { cost: { total: 2 } } })

    const result = await executeProviderRequest(
      provider,
      request(model, {
        context: undefined,
        messages: [{ role: 'user', content: 'Analyze' }],
        stream: true,
        maxTokens: 1000,
        tools: [tool],
      })
    )
    if (!('stream' in result)) throw new Error('Expected streaming execution')
    expect(await new Response(result.stream).text()).toBe('Final answer')
    const output = result.execution.output
    expect(output.tokens).toMatchObject({ prompt: inputTokens * 3, completion: 300 })
    expect(output.cost?.input).toBeCloseTo((inputTokens * 3 * inputRate) / 1e6, 8)
    expect(output.cost?.output).toBeCloseTo((300 * outputRate) / 1e6, 8)
    expect(output.cost?.toolCost).toBe(2)
    expect(output.cost?.total).toBeCloseTo(
      2 + (inputTokens * 3 * inputRate + 300 * outputRate) / 1e6,
      8
    )
    if (provider === 'mistral') {
      expect(mocks.chat.mock.calls[2][0].stream_options).toBeUndefined()
    }
  }
)

it.each([0, 1000])('prices direct Mistral stream usage, input=%s', async (inputTokens) => {
  let finishUsage!: () => void
  const pendingUsage = new Promise<void>((resolve) => {
    finishUsage = resolve
  })
  const usage = {
    prompt_tokens: inputTokens,
    completion_tokens: inputTokens / 10,
    total_tokens: inputTokens * 1.1,
  }
  mocks.chat.mockResolvedValueOnce(
    (async function* () {
      yield { choices: [{ delta: { content: 'Done' } }] }
      await pendingUsage
      yield { choices: [], usage }
    })()
  )
  const result = await executeProviderRequest(
    'mistral',
    request('mistral-large-4', { stream: true })
  )
  if (!('stream' in result)) throw new Error('Expected streaming execution')
  const initialCost = result.execution.output.cost
  finishUsage()
  expect(initialCost).toMatchObject({ input: 0, output: 0, total: 0 })
  expect(await new Response(result.stream).text()).toBe('Done')
  expect(result.execution.output.tokens).toEqual({
    prompt: inputTokens,
    completion: inputTokens / 10,
    total: inputTokens * 1.1,
  })
  expect(result.execution.output.cost?.total).toBeCloseTo(inputTokens ? 0.00091 : 0, 8)
  expect(mocks.chat).toHaveBeenCalledTimes(1)
  expect(mocks.chat.mock.calls[0][0].stream_options).toBeUndefined()
})

it('forwards Mistral reasoning effort and returns only answer content blocks', async () => {
  const content = [
    { type: 'thinking', thinking: [{ type: 'text', text: 'Private reasoning' }] },
    { type: 'text', text: 'Visible ' },
    { type: 'text', text: 'answer' },
  ]
  mocks.chat.mockResolvedValueOnce(completion({ role: 'assistant', content }))
  const result = await mistralProvider.executeRequest(
    request('mistral-large-4', { reasoningEffort: 'high' })
  )
  if ('stream' in result) throw new Error('Expected nonstreaming response')
  expect(result.content).toBe('Visible answer')
  expect(mocks.chat.mock.calls[0][0].reasoning_effort).toBe('high')
})

it('replays complete Mistral thinking content during tool continuations', async () => {
  const assistant = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'Preserved reasoning' }] },
      { type: 'text', text: 'I will look that up.' },
    ],
    tool_calls: [toolCall('mistral-tool')],
  }
  mocks.chat.mockResolvedValueOnce(completion(assistant)).mockResolvedValueOnce(completion())
  await mistralProvider.executeRequest(
    request('mistral-large-4', { reasoningEffort: 'high', tools: [tool] })
  )
  expect(mocks.chat.mock.calls[1][0].messages).toContainEqual(assistant)
})

it('pairs every failed Mistral tool call with an error result before continuing', async () => {
  const assistant = {
    role: 'assistant',
    content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Keep the complete turn' }] }],
    tool_calls: [
      toolCall('works-first'),
      { ...toolCall('malformed'), function: { name: tool.id, arguments: '{' } },
      toolCall('throws'),
      { ...toolCall('unknown'), function: { name: 'missing', arguments: '{}' } },
      toolCall('fails'),
      toolCall('works-last'),
    ],
  }
  mocks.chat.mockResolvedValueOnce(completion(assistant))
  mocks.tool
    .mockResolvedValueOnce({ success: true, output: { value: 42 } })
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ success: false, output: {}, error: 'Denied' })

  const result = await mistralProvider.executeRequest(request('mistral-large-4', { tools: [tool] }))
  expect(mocks.chat).toHaveBeenCalledTimes(2)
  expect(mocks.tool).toHaveBeenCalledTimes(4)
  const messages = mocks.chat.mock.calls[1][0].messages
  expect(messages.slice(0, 2)).toEqual([{ role: 'user', content: 'Analyze' }, assistant])
  expect(
    messages.slice(2).map((message: { tool_call_id: string }) => message.tool_call_id)
  ).toEqual(assistant.tool_calls.map((call) => call.id))
  expect(
    messages.slice(2).map((message: { content: string }) => JSON.parse(message.content))
  ).toEqual([
    { value: 42 },
    { error: true, message: expect.any(String), tool: tool.id },
    { error: true, message: 'Unavailable', tool: tool.id },
    { error: true, message: 'Unknown tool: missing', tool: 'missing' },
    { error: true, message: 'Denied', tool: tool.id },
    { value: 42 },
  ])
  expect(result).toMatchObject({
    content: 'Done',
    toolCalls: [true, false, true].map((success) => ({ success })),
    toolResults: [{ value: 42 }, { value: 42 }],
  })
})

it('streams only Mistral text chunks while preserving string deltas', async () => {
  mocks.chat.mockResolvedValueOnce(
    (async function* () {
      yield {
        choices: [
          {
            delta: {
              content: [
                { type: 'thinking', thinking: [{ type: 'text', text: 'Private reasoning' }] },
              ],
            },
          },
        ],
      }
      yield {
        choices: [
          {
            delta: {
              content: [
                { type: 'thinking', thinking: [] },
                { type: 'text', text: 'Visible ' },
              ],
            },
          },
        ],
      }
      yield { choices: [{ delta: { content: 'answer' } }] }
      yield {
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }
    })()
  )
  const result = await mistralProvider.executeRequest(
    request('mistral-large-4', { reasoningEffort: 'high', stream: true })
  )
  if (!('stream' in result)) throw new Error('Expected streaming execution')
  expect(await new Response(result.stream).text()).toBe('Visible answer')
  expect(result.execution.output.content).toBe('Visible answer')
})

it.each([undefined, 'auto', 'force'] as const)(
  'validates Bedrock tool usage when forcing is unsupported, mode=%s',
  async (usageControl) => {
    const withTools = usageControl !== undefined
    const schema = { type: 'object', properties: { value: { type: 'number' } } }
    const send = vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation(async () => ({
      output: { message: { role: 'assistant', content: [{ text: '{"value":42}' }] } },
      $metadata: {},
    }))
    try {
      const pending = executeProviderRequest(
        'bedrock',
        request('bedrock/openai.gpt-6.1-sol', {
          tools: withTools ? [{ ...tool, usageControl }] : undefined,
          responseFormat: { schema },
        })
      )
      if (usageControl === 'force') {
        await expect(pending).rejects.toThrow('does not support forced tool use')
        expect(send).not.toHaveBeenCalled()
        return
      }
      const result = await pending
      expect(send).toHaveBeenCalledTimes(1)
      const command = send.mock.calls[0][0]
      expect(command).toBeInstanceOf(ConverseCommand)
      expect(command.input).toMatchObject({
        system: [{ text: expect.stringContaining(JSON.stringify(schema)) }],
        toolConfig: withTools ? { toolChoice: { auto: {} } } : undefined,
      })
      expect(result).toMatchObject({ content: '{"value":42}' })
      expect(mocks.tool).not.toHaveBeenCalled()
    } finally {
      send.mockRestore()
    }
  }
)

it.each([
  ['google', 'gemini-2.5-flash', 0],
  ['google', 'gemini-2.5-flash-lite', 0],
  ['vertex', 'vertex/gemini-2.5-flash', 0],
  ['vertex', 'vertex/gemini-2.5-flash-lite', 0],
  ['google', 'gemini-2.5-pro', undefined],
  ['vertex', 'vertex/gemini-2.5-pro', undefined],
] as const)('handles explicit thinking disablement for %s %s', async (provider, model, budget) => {
  mocks.gemini.mockResolvedValueOnce({
    candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] } }],
  })
  await expect(
    executeProviderRequest(
      provider,
      request(model, { thinkingLevel: 'none', vertexProject: 'test-project' })
    )
  ).resolves.toMatchObject({ content: 'Done' })

  expect(mocks.gemini).toHaveBeenCalledTimes(1)
  const payload = mocks.gemini.mock.calls[0][0]
  expect(payload.model).toBe(model.replace(/^vertex\//, ''))
  expect(payload.config.thinkingConfig).toEqual(
    budget === 0 ? { includeThoughts: false, thinkingBudget: 0 } : undefined
  )
})

it('sends named thinking levels for Gemini 4', async () => {
  mocks.gemini.mockResolvedValueOnce({
    candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] } }],
  })
  await executeProviderRequest('google', request('gemini-4-argon', { thinkingLevel: 'high' }))
  expect(mocks.gemini.mock.calls[0][0].config.thinkingConfig).toEqual({
    includeThoughts: false,
    thinkingLevel: 'HIGH',
  })
})

it.each([
  'claude-fable-5-1',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-haiku-5-5',
  'azure-anthropic/claude-fable-5-1',
  'azure-anthropic/claude-sonnet-5-5',
  'azure-anthropic/claude-opus-5-5',
  'azure-anthropic/claude-haiku-5-5',
  'azure-anthropic/claude-opus-4-6',
])('uses adaptive thinking and preserves the catalog identity for %s', async (model) => {
  const provider = model.startsWith('azure-anthropic/') ? azureAnthropicProvider : anthropicProvider
  const result = await executeProviderRequest(
    provider.id,
    request(model, {
      thinkingLevel: 'high',
      maxTokens: 1000,
      azureEndpoint: 'https://example.services.ai.azure.com',
    })
  )
  expect(mocks.claude.mock.calls[0][0]).toMatchObject({
    model: model.replace(/^azure-anthropic\//, ''),
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
  })
  expect(result).toMatchObject({ model })
  if (model === 'azure-anthropic/claude-opus-4-6') {
    expect(result).toMatchObject({ cost: { pricing: { input: 5, output: 25 } } })
  }
})

it.each([
  ['claude-sonnet-5-5', 'between_tools'],
  ['claude-haiku-5-5', 'disabled'],
  ['azure-anthropic/claude-sonnet-5-5', 'between_tools'],
  ['azure-anthropic/claude-haiku-5-5', 'disabled'],
])('sends the explicit thinking-off mode for %s', async (model, type) => {
  await executeProviderRequest(
    model.startsWith('azure-anthropic/') ? 'azure-anthropic' : 'anthropic',
    request(model, {
      thinkingLevel: 'none',
      maxTokens: 1000,
      azureEndpoint: 'https://example.services.ai.azure.com',
    })
  )
  const payload = mocks.claude.mock.calls[0][0]
  expect(payload.thinking).toEqual({ type })
  expect(payload.output_config).toBeUndefined()
})

it.each([
  { provider: anthropicProvider, model: 'claude-fable-5-1' },
  { provider: anthropicProvider, model: 'claude-sonnet-5-5' },
  { provider: anthropicProvider, model: 'claude-opus-5-5' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-sonnet-5-5' },
])('rejects unsupported forced tools for $model', async ({ provider, model }) => {
  await expect(
    provider.executeRequest(
      request(model, {
        maxTokens: 1000,
        tools: [{ ...tool, usageControl: 'force' }],
        azureEndpoint: 'https://example.services.ai.azure.com',
      })
    )
  ).rejects.toThrow('does not support forced tool use')
  expect(mocks.claude).not.toHaveBeenCalled()
  expect(mocks.tool).not.toHaveBeenCalled()
})

it.each(
  (
    [
      [0, 0],
      [0.7, 0.7],
      [2, 2],
      [undefined, undefined],
      [-1, undefined],
      [3, undefined],
      [Number.NaN, undefined],
      [Number.POSITIVE_INFINITY, undefined],
    ] as const
  ).flatMap(([temperature, expected]) =>
    ['normal', 'stream', 'tools'].map((path) => ({ temperature, expected, path }))
  )
)(
  'dispatches Ollama temperature=$temperature through $path',
  async ({ temperature, expected, path }) => {
    if (path === 'tools')
      mocks.chat.mockResolvedValueOnce(completion({ tool_calls: [toolCall('next')] }))
    if (path === 'stream')
      mocks.chat.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: 'Done' } }] }
        })()
      )
    const result = await executeProviderRequest(
      'ollama',
      request('ollama/custom', {
        temperature,
        stream: path === 'stream',
        tools: path === 'tools' ? [tool] : undefined,
      })
    )
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
    expect(mocks.chat).toHaveBeenCalledTimes(path === 'tools' ? 2 : 1)
    for (const [payload] of mocks.chat.mock.calls) expect(payload.temperature).toBe(expected)
  }
)

it.each(
  (
    [
      [{ value: 42, cost: { total: 2 } }, '{"value":42,"cost":{"total":2}}', 2],
      [{ toJSON: () => undefined }, '{}', undefined],
      [{ toJSON: () => null }, 'null', undefined],
    ] as const
  ).flatMap(([toolOutput, text, toolCost]) =>
    [false, true].flatMap((stream) =>
      [tool.id, 'structured_output'].map((name) => ({ stream, name, toolOutput, text, toolCost }))
    )
  )
)(
  'pairs every Bedrock tool call with a result, stream=$stream, name=$name, text=$text',
  async ({ stream, name, toolOutput, text, toolCost }) => {
    const send = vi
      .spyOn(BedrockRuntimeClient.prototype, 'send')
      .mockImplementationOnce(async () => ({
        output: {
          message: {
            role: 'assistant',
            content: [
              { text: '   ' },
              { text: 'Calling tools' },
              {
                reasoningContent: {
                  reasoningText: { text: 'Need both results', signature: 'reasoning-signature' },
                },
              },
              { toolUse: { toolUseId: 'known', name, input: {} } },
              { toolUse: { toolUseId: 'unknown', name: 'missing', input: {} } },
            ],
          },
        },
        $metadata: {},
      }))
      .mockImplementationOnce(async () => ({
        output: { message: { role: 'assistant', content: [{ text: 'Done' }] } },
        $metadata: {},
      }))
    if (stream)
      send.mockImplementationOnce(async () => ({
        stream: (async function* () {
          yield { contentBlockDelta: { delta: { text: 'Done' } } }
        })(),
        $metadata: {},
      }))
    mocks.tool.mockResolvedValueOnce({ success: true, output: toolOutput })
    try {
      const result = await executeProviderRequest(
        'bedrock',
        request('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0', {
          stream,
          tools: [{ ...tool, id: name }],
        })
      )
      if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
      const followup = send.mock.calls[1][0]
      if (!(followup instanceof ConverseCommand)) throw new Error('Expected Bedrock continuation')
      expect(followup.input.messages?.slice(-2)).toMatchObject([
        {
          role: 'assistant',
          content: [
            { text: 'Calling tools' },
            {
              reasoningContent: {
                reasoningText: { text: 'Need both results', signature: 'reasoning-signature' },
              },
            },
            { toolUse: { toolUseId: 'known' } },
            { toolUse: { toolUseId: 'unknown' } },
          ],
        },
        {
          role: 'user',
          content: [
            { toolResult: { toolUseId: 'known', content: [{ text }] } },
            {
              toolResult: {
                toolUseId: 'unknown',
                content: [{ text: expect.stringContaining('Unknown tool: missing') }],
              },
            },
          ],
        },
      ])
      const output = 'stream' in result ? result.execution.output : result
      const calls = 'stream' in result ? result.execution.output.toolCalls?.list : result.toolCalls
      expect(calls).toMatchObject([
        { name },
        { name: 'missing', result: { error: true, message: 'Unknown tool: missing' } },
      ])
      expect(output.cost.toolCost).toBe(toolCost)
      expect(mocks.tool).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledTimes(stream ? 3 : 2)
    } finally {
      send.mockRestore()
    }
  }
)

it.each(
  (
    [
      [0, false],
      [1, false],
      [MAX_TOOL_ITERATIONS, false],
      [1, true],
    ] as const
  ).flatMap(([rounds, forced]) => [false, true].map((stream) => ({ rounds, forced, stream })))
)(
  'finishes Bedrock structured output after $rounds tools, forced=$forced, stream=$stream',
  async ({ rounds, forced, stream }) => {
    const value = { value: 42 }
    const expectedCalls = rounds + (forced ? 2 : 1)
    let turn = 0
    const send = vi
      .spyOn(BedrockRuntimeClient.prototype, 'send')
      .mockImplementation(async (command) => {
        if (!(command instanceof ConverseCommand) || turn >= expectedCalls)
          throw new Error('Unexpected additional Bedrock generation')
        const current = turn++
        const content =
          current < rounds
            ? [{ toolUse: { toolUseId: `tool-${current}`, name: tool.id, input: {} } }]
            : forced && current === rounds
              ? [{ text: 'Ready for structured output' }]
              : [
                  { text: 'Prefer the structured result' },
                  { toolUse: { toolUseId: 'structured', name: 'structured_output', input: value } },
                ]
        return {
          output: { message: { role: 'assistant', content } },
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
          $metadata: {},
        }
      })
    mocks.tool.mockResolvedValue({ success: true, output: { cost: { total: 2 } } })
    try {
      const result = await executeProviderRequest(
        'bedrock',
        request('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0', {
          stream,
          tools: rounds ? [tool] : undefined,
          responseFormat: { schema: { type: 'object', properties: { value: { type: 'number' } } } },
        })
      )
      if ('stream' in result) throw new Error('Structured output should already be complete')
      expect(JSON.parse(result.content)).toEqual(value)
      expect(send).toHaveBeenCalledTimes(expectedCalls)
      expect(mocks.tool).toHaveBeenCalledTimes(rounds)
      for (const [name] of mocks.tool.mock.calls) expect(name).toBe(tool.id)
      expect(result.tokens).toEqual({
        prompt: expectedCalls * 100,
        completion: expectedCalls * 10,
        total: expectedCalls * 110,
      })
      expect(result.cost.input).toBeCloseTo(expectedCalls * 0.0003, 8)
      expect(result.cost.output).toBeCloseTo(expectedCalls * 0.00015, 8)
      expect(result.cost.toolCost).toBe(rounds ? rounds * 2 : undefined)
      expect(result.cost.total).toBeCloseTo(expectedCalls * 0.00045 + rounds * 2, 8)
      expect(result.timing?.timeSegments?.filter(({ type }) => type === 'model')).toHaveLength(
        expectedCalls
      )
    } finally {
      send.mockRestore()
    }
  }
)

it.each([false, true])('rejects pending Bedrock tools at the limit, stream=%s', async (stream) => {
  let round = 0
  const send = vi
    .spyOn(BedrockRuntimeClient.prototype, 'send')
    .mockImplementation(async (command) => {
      if (!(command instanceof ConverseCommand)) throw new Error('Unexpected Bedrock stream')
      return {
        output: {
          message: {
            role: 'assistant',
            content: [{ toolUse: { toolUseId: `round-${round++}`, name: tool.id, input: {} } }],
          },
        },
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        $metadata: {},
      }
    })
  try {
    await expect(
      executeProviderRequest(
        'bedrock',
        request('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0', {
          stream,
          tools: [tool],
        })
      )
    ).rejects.toThrow('Bedrock exceeded the tool iteration limit')
    expect(send).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
    expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
  } finally {
    send.mockRestore()
  }
})

it('discovers qualified Ollama IDs and sends only the model name to the SDK', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }))
  )
  const discovery = await discoverOllamaModels()
  const { models } = await discovery.json()
  expect(models).toEqual(['ollama/llama3.2:latest'])
  const result = await ollamaProvider.executeRequest(request(models[0]))
  expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({ model: 'llama3.2:latest' }))
  expect(result).toMatchObject({ model: models[0] })
})

it('rejects unqualified Ollama IDs at the wire boundary', async () => {
  await expect(ollamaProvider.executeRequest(request('llama3.2:latest'))).rejects.toThrow(
    'Ollama model IDs must use ollama/<model>'
  )
})

it.each(
  ['models/custom', 'deployments/prod', 'models/adapter#accounts/acme/deployments/gpu'].flatMap(
    (resource) => [false, true].map((stream) => ({ resource, stream }))
  )
)('sends qualified Fireworks $resource, stream=$stream', async ({ resource, stream }) => {
  const wireModel = `accounts/acme/${resource}`
  const model = `fireworks/${wireModel}`
  mocks.chat.mockResolvedValueOnce(
    stream
      ? (async function* () {
          yield { choices: [{ delta: { content: 'Done' } }] }
        })()
      : completion()
  )
  const result = await executeProviderRequest('fireworks', request(model, { stream }))
  if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
  const output = 'stream' in result ? result.execution.output : result
  expect(output).toMatchObject({ model, content: 'Done' })
  expect(mocks.chat.mock.calls[0][0].model).toBe(wireModel)
})

it.each([
  'accounts/acme/models/custom',
  'fireworks/',
  'fireworks/glm-5.3',
  'fireworks/accounts//models/custom',
])('rejects unqualified Fireworks IDs before inference: %s', async (model) => {
  await expect(fireworksProvider.executeRequest(request(model))).rejects.toThrow(
    'Fireworks IDs must use fireworks/accounts/'
  )
  expect(mocks.chat).not.toHaveBeenCalled()
})

it('preserves Fireworks reasoning through tool and structured-output calls', async () => {
  const assistant = {
    role: 'assistant',
    content: 'I will look that up.',
    reasoning_content: 'Keep this reasoning unchanged.',
    tool_calls: [toolCall('fireworks-tool')],
  }
  mocks.chat
    .mockResolvedValueOnce(completion(assistant))
    .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Ready' }))
    .mockResolvedValueOnce(completion({ role: 'assistant', content: '{"value":42}' }))

  await fireworksProvider.executeRequest(
    request('fireworks/accounts/fireworks/models/glm-5p3', {
      reasoningEffort: 'high',
      tools: [tool],
      responseFormat: {
        name: 'result',
        schema: { type: 'object', properties: { value: { type: 'number' } } },
      },
    })
  )

  expect(mocks.chat.mock.calls.map(([payload]) => payload.reasoning_effort)).toEqual([
    'high',
    'high',
    'high',
  ])
  expect(mocks.chat.mock.calls[1][0].messages).toContainEqual(assistant)
  expect(mocks.chat.mock.calls[2][0]).toMatchObject({
    response_format: { type: 'json_schema' },
    tools: undefined,
    tool_choice: undefined,
  })
})

it.each([
  {
    provider: fireworksProvider,
    model: 'fireworks/accounts/fireworks/models/kimi-k3',
    params: { reasoningEffort: 'max', stream: true },
    expected: { reasoning_effort: 'max' },
  },
  {
    provider: groqProvider,
    model: 'groq/qwen/qwen3.8-27b',
    params: { reasoningEffort: 'high' },
    expected: { reasoning_effort: 'high' },
  },
  {
    provider: deepseekProvider,
    model: 'deepseek-v4-pro',
    params: { thinkingLevel: 'none' },
    expected: { reasoning_effort: 'none' },
  },
])(
  'forwards $model controls and omits them when unset',
  async ({ provider, model, params, expected }) => {
    await provider.executeRequest(request(model, params))
    expect(controls(mocks.chat.mock.calls[0][0])).toEqual(expected)
    mocks.chat.mockClear()
    await provider.executeRequest(request(model))
    expect(controls(mocks.chat.mock.calls[0][0])).toEqual({})
  }
)

it.each(
  [
    'gpt-5.3-codex',
    'gpt-6-astra',
    'gpt-6.1-sol',
    'gpt-6.1-terra',
    'gpt-4.1',
    'azure/gpt-6.1-sol',
    'azure/gpt-5.6-sol',
    'azure/gpt-5.6-terra',
    'azure/gpt-5.6-luna',
    'azure/gpt-5.4-pro',
    'azure/gpt-4.1',
  ].flatMap((model) => [false, true].map((stream) => ({ model, stream })))
)('executes $model through Responses, stream=$stream', async ({ model, stream }) => {
  const provider = model.startsWith('azure/') ? 'azure-openai' : 'openai'
  const result = await executeProviderRequest(provider, request(model, { stream }))
  if ('stream' in result) {
    expect(await new Response(result.stream).text()).toBe('Done')
    expect(result.execution.output.tokens).toEqual({ prompt: 10, completion: 5, total: 15 })
  } else {
    expect(result).toMatchObject({
      content: 'Done',
      tokens: { prompt: 10, completion: 5, total: 15 },
    })
  }
  expect(mocks.responses).toHaveBeenCalledTimes(1)
  expect(mocks.responses.mock.calls[0][0]).toMatchObject({
    model: model.replace(/^azure\//, ''),
    store: false,
  })
  expect(mocks.chat).not.toHaveBeenCalled()
})

it.each(['gpt-4.1', 'gpt-6.1-sol', 'azure/gpt-4.1', 'azure/gpt-6.1-sol', 'azure/gpt-5.6-sol'])(
  'maps optional Responses controls for %s',
  async (model) => {
    const provider = model.startsWith('azure/') ? 'azure-openai' : 'openai'
    const supportsReasoning = !model.endsWith('gpt-4.1')
    const effort = model.startsWith('azure/') ? 'max' : 'high'
    respond(response(), response())
    const schema = { type: 'object', properties: {}, required: [], additionalProperties: false }
    await executeProviderRequest(
      provider,
      request(model, {
        systemPrompt: 'Follow these instructions',
        messages: history,
        maxTokens: 4096,
        temperature: 0.4,
        reasoningEffort: effort,
        verbosity: 'low',
        responseFormat: { name: 'answer', schema },
      })
    )
    const payload = mocks.responses.mock.calls[0][0]
    expect(payload).toMatchObject({
      max_output_tokens: 4096,
      text: { format: { type: 'json_schema', name: 'answer', schema, strict: true } },
      input: expect.arrayContaining([
        { role: 'system', content: 'Follow these instructions' },
        { role: 'user', content: 'Analyze' },
        { type: 'function_call', call_id: 'previous', name: 'lookup', arguments: '{}' },
        { type: 'function_call_output', call_id: 'previous', output: '42' },
      ]),
    })
    expect(payload.temperature).toBe(supportsReasoning ? undefined : 0.4)
    expect(payload.reasoning).toEqual(supportsReasoning ? { effort } : undefined)
    expect(payload.text.verbosity).toBe(supportsReasoning ? 'low' : undefined)
    await executeProviderRequest(provider, request(model))
    const unset = mocks.responses.mock.calls[1][0]
    for (const field of ['temperature', 'max_output_tokens', 'reasoning', 'text']) {
      expect(unset[field]).toBeUndefined()
    }
  }
)

it.each(
  ['gpt-4.1', 'azure/gpt-4.1'].flatMap((model) =>
    (
      [
        [undefined, 0.002],
        [0, 0.002],
        [500, 0.00125],
        [1000, 0.0005],
      ] as const
    ).flatMap(([cachedTokens, inputCost]) =>
      [false, true].map((stream) => ({ model, cachedTokens, inputCost, stream }))
    )
  )
)(
  'prices $model using reported cached tokens=$cachedTokens, stream=$stream',
  async ({ model, cachedTokens, inputCost, stream }) => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 100,
      total_tokens: 1100,
      ...(cachedTokens !== undefined && { input_tokens_details: { cached_tokens: cachedTokens } }),
    }
    respond({ ...response(), usage })
    const provider = model.startsWith('azure/') ? 'azure-openai' : 'openai'
    const result = await executeProviderRequest(provider, request(model, { stream }))
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
    const output = 'stream' in result ? result.execution.output : result
    expect(output.tokens).toEqual({ prompt: 1000, completion: 100, total: 1100 })
    expect(output.cost.input).toBeCloseTo(inputCost, 8)
    expect(output.cost.output).toBeCloseTo(0.0008, 8)
    expect(output.cost.total).toBeCloseTo(inputCost + 0.0008, 8)
    expect(mocks.responses.mock.calls[0][0].input).toContainEqual({
      role: 'user',
      content: 'Analyze',
    })
  }
)

it.each(
  ['gpt-6.1-sol', 'azure/gpt-6.1-sol', 'azure/gpt-5.6-sol'].flatMap((model) =>
    [false, true].map((stream) => ({ model, stream }))
  )
)(
  'replays and prices each $model Responses tool turn, stream=$stream',
  async ({ model, stream }) => {
    const provider: ProviderId = model.startsWith('azure/') ? 'azure-openai' : 'openai'
    const [inputCost, outputCost] = model === 'azure/gpt-5.6-sol' ? [1.26, 0.006] : [0.882, 0.0035]
    const firstOutput = [
      { type: 'reasoning', id: 'reasoning', encrypted_content: 'opaque', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: 'Checking' }] },
      { type: 'function_call', call_id: 'first', name: tool.id, arguments: '{}' },
    ]
    const turns = [
      response(firstOutput),
      response([{ type: 'function_call', call_id: 'second', name: 'second', arguments: '{}' }]),
      response(),
    ]
    respond(
      ...turns.map((turn, index) => (payload: Record<string, unknown>) => ({
        ...turn,
        output: turn.output.map((item) =>
          item.type === 'reasoning'
            ? {
                ...item,
                encrypted_content:
                  provider === 'openai' ||
                  (Array.isArray(payload.include) &&
                    payload.include.includes('reasoning.encrypted_content'))
                    ? 'opaque'
                    : undefined,
              }
            : item
        ),
        usage: {
          input_tokens: index === 1 ? 280000 : 140000,
          output_tokens: 100,
          total_tokens: index === 1 ? 280100 : 140100,
          input_tokens_details: { cached_tokens: index === 0 ? 0 : 140000 },
        },
      }))
    )
    mocks.tool.mockResolvedValue({ success: true, output: { value: 42, cost: { total: 2 } } })
    const result = await executeProviderRequest(
      provider,
      request(model, {
        context: undefined,
        messages: [{ role: 'user', content: 'Analyze' }],
        stream,
        tools: [
          { ...tool, usageControl: 'force' },
          { ...tool, id: 'second', usageControl: 'force' },
          { ...tool, id: 'disabled', usageControl: 'none' },
        ],
      })
    )
    const output = 'stream' in result ? result.execution.output : result
    if ('stream' in result) {
      expect(await new Response(result.stream).text()).toBe('Done')
      expect(result.execution.output).toBe(output)
    }
    expect(output).toMatchObject({
      content: 'Done',
      tokens: { prompt: 560000, completion: 300, total: 560300 },
      cost: { toolCost: 4 },
    })
    expect(output.cost.input).toBeCloseTo(inputCost, 8)
    expect(output.cost.output).toBeCloseTo(outputCost, 8)
    expect(output.cost.total).toBeCloseTo(4 + inputCost + outputCost, 8)
    expect(mocks.responses).toHaveBeenCalledTimes(3)
    for (const [payload] of mocks.responses.mock.calls) {
      expect(payload.store).toBe(false)
      expect(payload.include).toEqual(
        provider === 'azure-openai' ? ['reasoning.encrypted_content'] : undefined
      )
    }
    expect(mocks.tool).toHaveBeenCalledTimes(2)
    expect(mocks.responses.mock.calls.map(([payload]) => payload.tool_choice)).toEqual([
      { type: 'function', name: tool.id },
      { type: 'function', name: 'second' },
      'auto',
    ])
    expect(mocks.responses.mock.calls[0][0].tools).toEqual(
      [tool.id, 'second'].map((name) => ({
        type: 'function',
        name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false,
      }))
    )
    expect(mocks.responses.mock.calls[1][0].input).toEqual(expect.arrayContaining(firstOutput))
    expect(mocks.responses.mock.calls[2][0].input).toEqual(
      expect.arrayContaining([
        {
          type: 'function_call_output',
          call_id: 'first',
          output: JSON.stringify({ value: 42, cost: { total: 2 } }),
        },
        {
          type: 'function_call_output',
          call_id: 'second',
          output: JSON.stringify({ value: 42, cost: { total: 2 } }),
        },
      ])
    )
  }
)

it.each(['invalid-json', 'unknown-tool', 'execution-error'])(
  'returns a Responses tool error for %s before continuing',
  async (failure) => {
    respond(
      response([
        {
          type: 'function_call',
          call_id: 'failed',
          name: failure === 'unknown-tool' ? 'unknown' : tool.id,
          arguments: failure === 'invalid-json' ? '{' : '{}',
        },
      ]),
      response()
    )
    if (failure === 'execution-error') mocks.tool.mockRejectedValueOnce(new Error('Tool failed'))
    await expect(
      executeProviderRequest('openai', request('gpt-6-astra', { tools: [tool] }))
    ).resolves.toMatchObject({ content: 'Done' })
    const items = mocks.responses.mock.calls[1][0].input
    const errorOutput = items.find((item: { type: string }) => item.type === 'function_call_output')
    expect(errorOutput.call_id).toBe('failed')
    expect(JSON.parse(errorOutput.output)).toMatchObject({ error: true })
    expect(mocks.responses).toHaveBeenCalledTimes(2)
  }
)

it.each([false, true])(
  'retains the final Responses answer at the tool limit, stream=%s',
  async (stream) => {
    respond(
      ...Array.from({ length: MAX_TOOL_ITERATIONS }, (_, i) =>
        response([{ type: 'function_call', call_id: `call-${i}`, name: tool.id, arguments: '{}' }])
      ),
      response()
    )
    const result = await executeProviderRequest(
      'openai',
      request('gpt-6-astra', { stream, tools: [tool] })
    )
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
    expect('stream' in result ? result.execution.output.content : result.content).toBe('Done')
    expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
    expect(mocks.responses).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
  }
)

it.each(['error', 'response.failed', 'response.incomplete', 'missing-terminal'])(
  'rejects an unusable Responses stream: %s',
  async (eventType) => {
    mocks.responses.mockReset().mockResolvedValueOnce(
      (async function* () {
        yield { type: 'response.output_text.delta', delta: 'Partial' }
        if (eventType === 'error') yield { type: 'error', message: 'Provider failed' }
        else if (eventType !== 'missing-terminal')
          yield {
            type: eventType,
            response: {
              ...response(),
              status: eventType.split('.')[1],
              incomplete_details: { reason: 'content_filter' },
            },
          }
      })()
    )
    const result = await executeProviderRequest('openai', request('gpt-6-astra', { stream: true }))
    if (!('stream' in result)) throw new Error('Expected streaming execution')
    await expect(new Response(result.stream).text()).rejects.toThrow()
    expect(result.execution.success).toBe(false)
  }
)

it.each([false, true])(
  'stops remaining Responses tools after cancellation, stream=%s',
  async (stream) => {
    const cancellation = new AbortController()
    respond(
      response(
        ['first', 'second'].map((call_id) => ({
          type: 'function_call',
          call_id,
          name: tool.id,
          arguments: '{}',
        }))
      )
    )
    mocks.tool.mockImplementationOnce(async () => {
      cancellation.abort(new Error('Cancelled'))
      return { success: true, output: {} }
    })
    const pending = executeProviderRequest(
      'openai',
      request('gpt-6-astra', {
        stream,
        tools: [tool],
        abortSignal: cancellation.signal,
      })
    )
    if (stream) {
      const result = await pending
      if (!('stream' in result)) throw new Error('Expected streaming execution')
      await expect(new Response(result.stream).text()).rejects.toThrow('Cancelled')
    } else await expect(pending).rejects.toThrow('Cancelled')
    expect(mocks.tool).toHaveBeenCalledTimes(1)
    expect(mocks.responses).toHaveBeenCalledTimes(1)
  }
)

it.each(
  ['bedrock/minimax.minimax-m2.5', 'bedrock/openai.gpt-oss-120b-1:0'].flatMap((model) =>
    [false, true].map((stream) => ({ model, stream }))
  )
)('invokes $model using its raw Bedrock ID, stream=$stream', async ({ model, stream }) => {
  const send = vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation(async () =>
    stream
      ? {
          stream: (async function* () {
            yield { contentBlockDelta: { delta: { text: 'Done' } } }
            yield { metadata: { usage: { inputTokens: 10, outputTokens: 5 } } }
          })(),
        }
      : { output: { message: { role: 'assistant', content: [{ text: 'Done' }] } }, $metadata: {} }
  )
  try {
    const result = await executeProviderRequest('bedrock', request(model, { stream }))
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
    else expect(result.content).toBe('Done')
    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0][0]
    expect(command).toBeInstanceOf(stream ? ConverseStreamCommand : ConverseCommand)
    if (!(command instanceof ConverseCommand || command instanceof ConverseStreamCommand)) {
      throw new Error('Expected Bedrock Converse command')
    }
    expect(command.input.modelId).toBe(model.slice('bedrock/'.length))
  } finally {
    send.mockRestore()
  }
})

it.each([
  ['none', 'none', 'stream'],
  ['low', 'low', 'tools'],
  ['medium', 'medium', 'normal'],
  ['high', 'high', 'normal'],
  [undefined, undefined, 'normal'],
  ['auto', undefined, 'normal'],
  ['invalid', undefined, 'normal'],
] as const)(
  'dispatches Cerebras reasoning effort %s as %s through %s',
  async (reasoningEffort, expected, path) => {
    if (path === 'tools') {
      mocks.chat
        .mockResolvedValueOnce(completion({ tool_calls: [toolCall('next')] }))
        .mockResolvedValueOnce(
          (async function* () {
            yield { choices: [{ delta: { content: 'Done' } }] }
          })()
        )
    } else if (path === 'stream') {
      mocks.chat.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: 'Done' } }] }
        })()
      )
    }
    const result = await executeProviderRequest(
      'cerebras',
      request('cerebras/qwen-3.8-27b', {
        reasoningEffort,
        stream: path !== 'normal',
        tools: path === 'tools' ? [tool] : undefined,
      })
    )
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
    else expect(result.content).toBe('Done')
    expect(mocks.chat).toHaveBeenCalledTimes(path === 'tools' ? 2 : 1)
    expect(mocks.tool).toHaveBeenCalledTimes(path === 'tools' ? 1 : 0)
    for (const [payload] of mocks.chat.mock.calls) {
      expect(payload.model).toBe('qwen-3.8-27b')
      expect(controls(payload)).toEqual(
        expected === undefined ? {} : { reasoning_effort: expected }
      )
    }
    if (path === 'tools') expect(mocks.chat.mock.calls[1][0].tool_choice).toBe('none')
  }
)

it.each(
  ['google', 'vertex'].flatMap((provider) =>
    (
      [
        [undefined, 0.02],
        [0, 0.02],
        [5000, 0.011],
        [10000, 0.002],
      ] as const
    ).flatMap(([cachedTokens, inputCost]) =>
      [false, true].map((stream) => ({ provider, cachedTokens, inputCost, stream }))
    )
  )
)(
  'prices $provider Interactions cache hits=$cachedTokens, stream=$stream',
  async ({ provider, cachedTokens, inputCost, stream }) => {
    const model = `${provider === 'vertex' ? 'vertex/' : ''}deep-research-pro-preview-12-2025`
    const interaction = {
      id: 'research',
      status: 'completed',
      outputs: [{ type: 'text', text: 'Done' }],
      usage: {
        total_input_tokens: 10000,
        total_output_tokens: 100,
        total_tokens: 10100,
        ...(cachedTokens === undefined ? {} : { total_cached_tokens: cachedTokens }),
      },
    }
    mocks.gemini.mockResolvedValueOnce(
      stream
        ? (async function* () {
            yield { event_type: 'content.delta', delta: { type: 'text', text: 'Done' } }
            yield { event_type: 'interaction.complete', interaction }
          })()
        : interaction
    )
    const result = await executeProviderRequest(
      provider,
      request(model, { stream, vertexProject: 'test-project' })
    )
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
    const output = 'stream' in result ? result.execution.output : result
    expect(output.cost.input).toBeCloseTo(inputCost, 8)
    expect(output.cost.output).toBeCloseTo(0.0012, 8)
    expect(output.cost.total).toBeCloseTo(inputCost + 0.0012, 8)
    expect(output.tokens).toEqual(
      stream
        ? { input: 10000, output: 100, total: 10100 }
        : { prompt: 10000, completion: 100, total: 10100 }
    )
  }
)

const cachedModels = [
  ['deepseek', 'deepseek-flash', 0.0003, 0.000153, 0.000006, 0.00012],
  ['deepseek', 'deepseek-v4-pro', 0.00132, 0.000682, 0.000044, 0.000396],
  ['xai', 'grok-4.6', 0.002, 0.00125, 0.0005, 0.0006],
  ['mistral', 'mistral-large-4', 0.0007, 0.000385, 0.00007, 0.00021],
  ['groq', 'groq/openai/gpt-oss-120b', 0.00015, 0.0001125, 0.000075, 0.00006],
  ['fireworks', 'fireworks/accounts/fireworks/models/glm-5p3', 0.0014, 0.00083, 0.00026, 0.00044],
  ['openrouter', 'openrouter/openai/gpt-4.1', 0.002048, 0.00128, 0.000512, 0.0008, 1024],
  ['google', 'gemini-2.5-flash', 0.003, 0.00165, 0.0003, 0.00025, 10000],
  ['vertex', 'vertex/gemini-2.5-flash', 0.003, 0.00165, 0.0003, 0.00025, 10000],
  ['google', 'gemini-2.5-pro', 0.500005, 0.27500275, 0.0500005, 0.0015, 200002],
] as const

it.each(
  cachedModels.flatMap(([provider, model, cold, partial, cached, outputCost, prompt = 1000]) =>
    (
      [
        [undefined, cold],
        [0, cold],
        [prompt / 2, partial],
        [prompt, cached],
      ] as const
    ).flatMap(([cachedTokens, inputCost]) =>
      [false, true].map((stream) => ({
        provider,
        model,
        cachedTokens,
        inputCost,
        outputCost,
        prompt,
        stream,
      }))
    )
  )
)(
  'prices $model reported cache hits=$cachedTokens, stream=$stream',
  async ({ provider, model, cachedTokens, inputCost, outputCost, prompt, stream }) => {
    const gemini = provider === 'google' || provider === 'vertex'
    const usage = {
      prompt_tokens: prompt,
      completion_tokens: 100,
      total_tokens: prompt + 100,
      ...(cachedTokens === undefined
        ? {}
        : provider === 'deepseek'
          ? { prompt_cache_hit_tokens: cachedTokens }
          : { prompt_tokens_details: { cached_tokens: cachedTokens } }),
    }
    const response = gemini
      ? {
          text: 'Done',
          candidates: [{ content: { parts: [{ text: 'Done' }] } }],
          usageMetadata: {
            promptTokenCount: prompt,
            candidatesTokenCount: 100,
            totalTokenCount: prompt + 100,
            ...(cachedTokens === undefined ? {} : { cachedContentTokenCount: cachedTokens }),
          },
        }
      : { ...completion(), usage }
    const generate = gemini ? mocks.gemini : mocks.chat
    generate.mockResolvedValueOnce(
      stream
        ? (async function* () {
            if (gemini) yield response
            else {
              yield { choices: [{ delta: { content: 'Done' } }] }
              yield provider === 'groq'
                ? { choices: [], x_groq: { usage } }
                : { choices: [], usage }
            }
          })()
        : response
    )
    const result = await executeProviderRequest(
      provider,
      request(model, { stream, vertexProject: 'test-project' })
    )
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
    const output = 'stream' in result ? result.execution.output : result
    expect(output.tokens).toEqual(
      gemini && stream
        ? { input: prompt, output: 100, total: prompt + 100 }
        : { prompt, completion: 100, total: prompt + 100 }
    )
    expect(output.cost.input).toBeCloseTo(inputCost, 8)
    expect(output.cost.output).toBeCloseTo(outputCost, 8)
    expect(output.cost.total).toBeCloseTo(inputCost + outputCost, 8)
  }
)

it.each(
  cachedModels.flatMap(([provider, model, cold, partial, cached, outputCost, prompt = 1000]) =>
    [false, true].map((stream) => ({
      provider,
      model,
      cold,
      partial,
      cached,
      outputCost,
      prompt,
      stream,
    }))
  )
)(
  'preserves $model cached usage across tool turns, stream=$stream',
  async ({ provider, model, cold, partial, cached, outputCost, prompt, stream }) => {
    const gemini = provider === 'google' || provider === 'vertex'
    const hits = [0, prompt / 2, prompt]
    const usages = hits.map((cachedTokens) => ({
      prompt_tokens: prompt,
      completion_tokens: 100,
      total_tokens: prompt + 100,
      ...(provider === 'deepseek'
        ? { prompt_cache_hit_tokens: cachedTokens }
        : { prompt_tokens_details: { cached_tokens: cachedTokens } }),
    }))
    const content = provider === 'fireworks' ? '{"value":42}' : 'Done'
    const geminiAssistantContent = {
      role: 'model',
      parts: [
        { text: 'Calling the tool', thoughtSignature: 'text-signature' },
        {
          functionCall: { name: tool.id, args: {} },
          thoughtSignature: 'function-signature',
        },
      ],
    }
    const responses = usages.map((usage, index) =>
      gemini
        ? {
            text: index === 0 ? undefined : content,
            candidates: [
              {
                content: index === 0 ? geminiAssistantContent : { parts: [{ text: content }] },
              },
            ],
            ...(index === 0 && { functionCalls: [{ name: tool.id, args: {} }] }),
            usageMetadata: {
              promptTokenCount: prompt,
              candidatesTokenCount: 100,
              totalTokenCount: prompt + 100,
              cachedContentTokenCount: hits[index],
            },
          }
        : index === 0
          ? {
              ...completion({
                role: 'assistant',
                content: null,
                tool_calls: [toolCall('cached-tool')],
              }),
              usage,
            }
          : { ...completion({ role: 'assistant', content }), usage }
    )
    const generate = gemini ? mocks.gemini : mocks.chat
    const calls = provider === 'fireworks' || (stream && !gemini) ? 3 : 2
    responses.slice(0, calls).forEach((response, index) => {
      generate.mockResolvedValueOnce(
        stream && (gemini || index === 2)
          ? (async function* () {
              if (gemini) yield response
              else {
                yield { choices: [{ delta: { content } }] }
                yield provider === 'groq'
                  ? { choices: [], x_groq: { usage: usages[index] } }
                  : { choices: [], usage: usages[index] }
              }
            })()
          : response
      )
    })
    mocks.tool.mockResolvedValueOnce({ success: true, output: { cost: { total: 2 } } })
    const result = await executeProviderRequest(
      provider,
      request(model, {
        stream,
        vertexProject: 'test-project',
        tools: [tool],
        ...(provider === 'fireworks' && {
          responseFormat: {
            schema: {
              type: 'object',
              properties: { value: { type: 'number' } },
              required: ['value'],
              additionalProperties: false,
            },
          },
        }),
      })
    )
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe(content)
    const output = 'stream' in result ? result.execution.output : result
    expect(output.tokens).toEqual(
      gemini && stream
        ? { input: calls * prompt, output: calls * 100, total: calls * (prompt + 100) }
        : { prompt: calls * prompt, completion: calls * 100, total: calls * (prompt + 100) }
    )
    const inputCost = cold + partial + (calls === 3 ? cached : 0)
    expect(output.cost.input).toBeCloseTo(inputCost, 8)
    expect(output.cost.output).toBeCloseTo(outputCost * calls, 8)
    expect(output.cost.toolCost).toBe(2)
    expect(output.cost.total).toBeCloseTo(2 + inputCost + outputCost * calls, 8)
    expect(generate).toHaveBeenCalledTimes(calls)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
    if (gemini) {
      expect(generate.mock.calls[1][0].contents.slice(-2)).toEqual([
        geminiAssistantContent,
        {
          role: 'user',
          parts: [{ functionResponse: { name: tool.id, response: { cost: { total: 2 } } } }],
        },
      ])
    }
  }
)

const geminiToolResponse = (id: string) => ({
  candidates: [
    {
      content: {
        role: 'model',
        parts: [{ functionCall: { name: tool.id, args: {} }, thoughtSignature: id }],
      },
    },
  ],
  functionCalls: [{ name: tool.id, args: {} }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
})

it('accepts a completed Gemini answer after the maximum tool iterations', async () => {
  let call = 0
  mocks.gemini.mockImplementation(async () => {
    const current = call++
    return current < MAX_TOOL_ITERATIONS
      ? geminiToolResponse(`call-${current}`)
      : {
          candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] } }],
          text: 'Done',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }
  })

  await expect(
    executeProviderRequest('google', request('gemini-2.5-flash', { tools: [tool] }))
  ).resolves.toMatchObject({ content: 'Done' })
  expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
  expect(mocks.gemini).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
})

it.each(
  [false, true].flatMap((stream) => [false, true].map((structured) => ({ stream, structured })))
)(
  'rejects pending Gemini tools at the limit, stream=$stream, structured=$structured',
  async ({ stream, structured }) => {
    let call = 0
    mocks.gemini.mockImplementation(async () => {
      const response = geminiToolResponse(`call-${call++}`)
      return stream
        ? (async function* () {
            yield response
          })()
        : response
    })

    const result = executeProviderRequest(
      'google',
      request('gemini-2.5-flash', {
        stream,
        tools: [tool],
        responseFormat: structured ? { schema: { type: 'object' }, strict: false } : undefined,
      })
    )
    await expect(
      result.then(async (response) => {
        if ('stream' in response) await new Response(response.stream).text()
      })
    ).rejects.toThrow('Gemini exceeded the tool iteration limit')
    expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
    expect(mocks.gemini).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
  }
)

it.each(
  ['deepseek-v4-pro', 'deepseek-flash'].flatMap((model) =>
    [undefined, 'enabled'].flatMap((thinkingLevel) =>
      [false, true].map((stream) => ({ model, thinkingLevel, stream }))
    )
  )
)(
  'rejects forced $model tools with thinking=$thinkingLevel, stream=$stream',
  async ({ model, thinkingLevel, stream }) => {
    await expect(
      deepseekProvider.executeRequest(
        request(model, { thinkingLevel, stream, tools: [{ ...tool, usageControl: 'force' }] })
      )
    ).rejects.toThrow('does not support forced tool use')
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.tool).not.toHaveBeenCalled()
  }
)

it('applies non-strict DeepSeek response format without rewriting JSON strings', async () => {
  const content = '{"value":"keep ```json and ``` markers"}'
  const schema = { type: 'object', properties: { value: { type: 'string' } } }
  mocks.chat
    .mockResolvedValueOnce(
      completion({ role: 'assistant', content: null, tool_calls: [toolCall('schema')] })
    )
    .mockResolvedValueOnce(completion({ role: 'assistant', content }, 'stop'))

  const result = await executeProviderRequest(
    'deepseek',
    request('deepseek-flash', {
      systemPrompt: 'Keep this instruction',
      responseFormat: { name: 'answer', schema, strict: false },
      tools: [tool],
    })
  )
  if ('stream' in result) throw new Error('Expected completed execution')
  expect(result.content).toBe(content)
  expect(mocks.chat).toHaveBeenCalledTimes(2)
  expect(mocks.tool).toHaveBeenCalledTimes(1)
  for (const [payload] of mocks.chat.mock.calls) {
    expect(payload.response_format).toEqual({ type: 'json_object' })
    const systemMessage = payload.messages.find(
      (message: { role: string }) => message.role === 'system'
    )
    expect(systemMessage.content).toContain('Keep this instruction')
    expect(systemMessage.content).toContain(JSON.stringify(schema))
  }
})

it('rejects strict DeepSeek response formats before inference', async () => {
  await expect(
    deepseekProvider.executeRequest(
      request('deepseek-flash', {
        responseFormat: { schema: { type: 'object' } },
      })
    )
  ).rejects.toThrow('does not support strict JSON Schema')
  expect(mocks.chat).not.toHaveBeenCalled()
})

it.each(['nonstream-tool', 'stream-tool', 'stream-direct'] as const)(
  'rejects empty DeepSeek JSON in %s responses',
  async (mode) => {
    const stream = mode.startsWith('stream')
    const afterTool = mode.endsWith('tool')
    if (afterTool) {
      mocks.chat
        .mockResolvedValueOnce(
          completion({
            role: 'assistant',
            content: '{"stale":true}',
            tool_calls: [toolCall('schema')],
          })
        )
        .mockResolvedValueOnce(completion({ role: 'assistant', content: '' }))
    }
    if (stream) mocks.chat.mockResolvedValueOnce((async function* () {})())

    const execution = deepseekProvider.executeRequest(
      request('deepseek-flash', {
        responseFormat: { schema: { type: 'object' }, strict: false },
        stream,
        tools: afterTool ? [tool] : undefined,
      })
    )
    if (!stream) {
      await expect(execution).rejects.toThrow('returned an empty JSON response')
      return
    }
    const result = await execution
    if (!('stream' in result)) throw new Error('Expected streaming execution')
    await expect(new Response(result.stream).text()).rejects.toThrow(
      'returned an empty JSON response'
    )
  }
)

it.each(['nonstream', 'stream-direct', 'stream-tool'] as const)(
  'rejects length-truncated DeepSeek JSON in %s responses',
  async (mode) => {
    const stream = mode !== 'nonstream'
    const afterTool = mode === 'stream-tool'
    if (afterTool) {
      mocks.chat
        .mockResolvedValueOnce(
          completion(
            { role: 'assistant', content: null, tool_calls: [toolCall('schema')] },
            'tool_calls'
          )
        )
        .mockResolvedValueOnce(completion({ role: 'assistant', content: '{"intermediate":true}' }))
    }
    if (stream) {
      mocks.chat.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: '{"value":42}' }, finish_reason: 'length' }] }
          yield {
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }
        })()
      )
    } else {
      mocks.chat.mockResolvedValueOnce(
        completion({ role: 'assistant', content: '{"value":42}' }, 'length')
      )
    }

    const execution = deepseekProvider.executeRequest(
      request('deepseek-flash', {
        responseFormat: { schema: { type: 'object' }, strict: false },
        stream,
        tools: afterTool ? [tool] : undefined,
      })
    )
    if (!stream) {
      await expect(execution).rejects.toThrow('returned a truncated JSON response')
      return
    }
    const result = await execution
    if (!('stream' in result)) throw new Error('Expected streaming execution')
    await expect(new Response(result.stream).text()).rejects.toThrow(
      'returned a truncated JSON response'
    )
  }
)

it.each([false, true])(
  'preserves DeepSeek streamed Markdown metadata after tools=%s',
  async (afterTool) => {
    const content = '```python\nprint(1)\n```'
    if (afterTool) {
      mocks.chat
        .mockResolvedValueOnce(
          completion({ role: 'assistant', content: null, tool_calls: [toolCall('markdown')] })
        )
        .mockResolvedValueOnce(completion())
    }
    mocks.chat.mockResolvedValueOnce(
      (async function* () {
        yield { choices: [{ delta: { content }, finish_reason: 'stop' }] }
      })()
    )

    const result = await deepseekProvider.executeRequest(
      request('deepseek-flash', { stream: true, tools: afterTool ? [tool] : undefined })
    )
    if (!('stream' in result)) throw new Error('Expected streaming execution')
    expect(await new Response(result.stream).text()).toBe(content)
    expect(result.execution.output.content).toBe(content)
  }
)

it.each(['deepseek-v4-pro', 'deepseek-flash'])(
  'honors forced %s tools when thinking is explicitly disabled',
  async (model) => {
    mocks.chat.mockResolvedValueOnce(
      completion({ role: 'assistant', content: null, tool_calls: [toolCall('forced')] })
    )
    await deepseekProvider.executeRequest(
      request(model, { thinkingLevel: 'none', tools: [{ ...tool, usageControl: 'force' }] })
    )
    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
    expect(mocks.chat.mock.calls.map(([payload]) => payload.tool_choice)).toEqual([
      { type: 'function', function: { name: tool.id } },
      'auto',
    ])
    for (const [payload] of mocks.chat.mock.calls) {
      expect(payload.reasoning_effort).toBe('none')
      expect(payload.thinking).toBeUndefined()
    }
  }
)

it('preserves complete DeepSeek reasoning and parallel tool calls through followups', async () => {
  const assistant = {
    role: 'assistant',
    content: null,
    reasoning_content: 'Reasoning required by the API',
    tool_calls: [toolCall('first'), toolCall('second')],
  }
  mocks.chat.mockResolvedValueOnce(completion(assistant))
  await deepseekProvider.executeRequest(
    request('deepseek-v4-pro', {
      thinkingLevel: 'max',
      tools: [tool],
    })
  )
  expect(mocks.tool).toHaveBeenCalledTimes(2)
  expect(mocks.chat).toHaveBeenCalledTimes(2)
  for (const [payload] of mocks.chat.mock.calls) {
    expect(controls(payload)).toEqual({ reasoning_effort: 'max' })
  }
  expect(mocks.chat.mock.calls[1][0].messages).toEqual([
    { role: 'user', content: 'Analyze' },
    assistant,
    { role: 'tool', tool_call_id: 'first', content: '{"value":42}' },
    { role: 'tool', tool_call_id: 'second', content: '{"value":42}' },
  ])
})

it('pairs every failed DeepSeek tool call with an error result before continuing', async () => {
  const assistant = {
    role: 'assistant',
    content: null,
    reasoning_content: 'Keep the complete tool turn',
    tool_calls: [
      { ...toolCall('malformed'), function: { name: tool.id, arguments: '{' } },
      toolCall('throws'),
      { ...toolCall('unknown'), function: { name: 'missing', arguments: '{}' } },
      toolCall('fails'),
      toolCall('works'),
    ],
  }
  mocks.chat.mockResolvedValueOnce(completion(assistant))
  mocks.tool
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ success: false, output: {}, error: 'Denied' })

  const result = await deepseekProvider.executeRequest(request('deepseek-flash', { tools: [tool] }))
  expect(mocks.chat).toHaveBeenCalledTimes(2)
  expect(mocks.tool).toHaveBeenCalledTimes(3)
  const messages = mocks.chat.mock.calls[1][0].messages
  expect(messages.slice(0, 2)).toEqual([{ role: 'user', content: 'Analyze' }, assistant])
  expect(
    messages.slice(2).map((message: { tool_call_id: string }) => message.tool_call_id)
  ).toEqual(['malformed', 'throws', 'unknown', 'fails', 'works'])
  expect(
    messages.slice(2).map((message: { content: string }) => JSON.parse(message.content))
  ).toEqual([
    { error: true, message: expect.any(String), tool: tool.id },
    { error: true, message: 'Unavailable', tool: tool.id },
    { error: true, message: 'Unknown tool: missing', tool: 'missing' },
    { error: true, message: 'Denied', tool: tool.id },
    { value: 42 },
  ])
  expect(result).toMatchObject({
    content: 'Done',
    toolCalls: [false, false, false, false, true].map((success) => ({ success })),
    toolResults: [{ value: 42 }],
  })
})

it('rejects DeepSeek continuation errors instead of returning partial success', async () => {
  mocks.chat
    .mockResolvedValueOnce(
      completion({ role: 'assistant', content: null, tool_calls: [toolCall('next')] })
    )
    .mockRejectedValueOnce(new Error('DeepSeek unavailable'))
  await expect(
    deepseekProvider.executeRequest(request('deepseek-flash', { tools: [tool] }))
  ).rejects.toThrow('DeepSeek unavailable')
  expect(mocks.chat).toHaveBeenCalledTimes(2)
})

it('accepts a completed DeepSeek answer after the maximum tool iterations', async () => {
  let call = 0
  mocks.chat.mockImplementation(async () => {
    const current = call++
    return current < MAX_TOOL_ITERATIONS
      ? completion(
          { role: 'assistant', content: null, tool_calls: [toolCall(`call-${current}`)] },
          'tool_calls'
        )
      : completion({ role: 'assistant', content: '{"value":42}' }, 'stop')
  })

  await expect(
    deepseekProvider.executeRequest(
      request('deepseek-flash', {
        tools: [tool],
        responseFormat: { schema: { type: 'object' }, strict: false },
      })
    )
  ).resolves.toMatchObject({ content: '{"value":42}' })
  expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
  expect(mocks.chat).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
})

it.each([
  { mode: 'ordinary', stream: false, structured: false },
  { mode: 'ordinary streaming', stream: true, structured: false },
  { mode: 'structured', stream: false, structured: true },
  { mode: 'structured streaming', stream: true, structured: true },
])(
  'rejects pending DeepSeek tools at the iteration limit in $mode mode',
  async ({ stream, structured }) => {
    let call = 0
    mocks.chat.mockImplementation(async () =>
      completion(
        { role: 'assistant', content: null, tool_calls: [toolCall(`call-${++call}`)] },
        'tool_calls'
      )
    )

    await expect(
      deepseekProvider.executeRequest(
        request('deepseek-flash', {
          stream,
          tools: [tool],
          responseFormat: structured ? { schema: { type: 'object' }, strict: false } : undefined,
        })
      )
    ).rejects.toThrow('DeepSeek exceeded the tool iteration limit')
    expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
    expect(mocks.chat).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
  }
)

it.each([
  {
    name: 'Fireworks',
    provider: fireworksProvider,
    model: 'fireworks/accounts/fireworks/models/glm-5p3',
  },
  { name: 'Groq', provider: groqProvider, model: 'groq/openai/gpt-oss-120b' },
  { name: 'Mistral', provider: mistralProvider, model: 'mistral-large-4' },
  {
    name: 'Ollama',
    provider: ollamaProvider,
    model: 'ollama/custom',
  },
  {
    name: 'OpenRouter',
    provider: openRouterProvider,
    model: 'openrouter/openai/gpt-4.1',
  },
  { name: 'vLLM', provider: vllmProvider, model: 'vllm/custom-model' },
  { name: 'xAI', provider: xAIProvider, model: 'grok-4.5' },
])(
  '$name rejects pending tools at the shared iteration limit',
  async ({ name, provider, model }) => {
    let call = 0
    mocks.chat.mockImplementation(async () =>
      completion(
        { role: 'assistant', content: null, tool_calls: [toolCall(`call-${++call}`)] },
        'tool_calls'
      )
    )

    await expect(provider.executeRequest(request(model, { tools: [tool] }))).rejects.toThrow(
      `${name} exceeded the tool iteration limit`
    )
    expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
    expect(mocks.chat).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
  }
)

it.each([
  {
    provider: anthropicProvider,
    model: 'claude-haiku-5-5',
    stream: false,
    streamToolCalls: false,
  },
  {
    provider: azureAnthropicProvider,
    model: 'azure-anthropic/claude-opus-5',
    stream: true,
    streamToolCalls: false,
  },
  {
    provider: anthropicProvider,
    model: 'claude-haiku-5-5',
    stream: true,
    streamToolCalls: true,
  },
])(
  'preserves Claude tool turns for $provider.id, stream=$stream, streamToolCalls=$streamToolCalls',
  async (mode) => {
    const thinking = { type: 'thinking', thinking: 'Checking data', signature: 'signature' }
    const call = { type: 'tool_use', id: 'next', name: tool.id, input: {} }
    const assistantContent = [
      thinking,
      { type: 'text', text: 'I will check the data.' },
      { type: 'redacted_thinking', data: 'opaque-reasoning' },
      { type: 'thinking', thinking: 'Choosing a tool', signature: 'second-signature' },
      call,
    ]
    mocks.claude.mockResolvedValueOnce({
      content: assistantContent,
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const result = await mode.provider.executeRequest(
      request(mode.model, {
        stream: mode.stream,
        streamToolCalls: mode.streamToolCalls,
        messages: history,
        maxTokens: 4096,
        thinkingLevel: 'high',
        tools: [{ ...tool, usageControl: 'force' }],
        responseFormat: { name: 'result', schema: { type: 'object', properties: {} } },
        azureEndpoint: 'https://example.services.ai.azure.com',
      })
    )
    expect(mocks.tool).toHaveBeenCalledWith(tool.id, expect.any(Object))
    expect(mocks.claude).toHaveBeenCalledTimes(2)
    const initial = mocks.claude.mock.calls[0][0]
    expect(initial.tool_choice).toEqual({ type: 'tool', name: tool.id })
    expect(mocks.claude.mock.calls[1][0].tool_choice).toBeUndefined()
    expect(initial.messages[1].content[0]).toMatchObject({ type: 'tool_use', id: 'previous' })
    expect(initial.messages[2].content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'previous',
    })
    for (const [payload] of mocks.claude.mock.calls) {
      expect(payload).toMatchObject({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        output_format: { type: 'json_schema' },
      })
    }
    const followup = mocks.claude.mock.calls[1][0].messages
    expect(followup.at(-2)).toEqual({ role: 'assistant', content: assistantContent })
    expect(followup.at(-1).content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'next',
      content: '{"value":42}',
    })
    expect(result).toMatchObject({
      content: 'Done',
      tokens: { input: 20, output: 10, total: 30 },
      toolCalls: [{ name: tool.id, result: { value: 42 } }],
      toolResults: [{ value: 42 }],
      timing: { iterations: 2 },
    })
  }
)

it.each([
  { provider: anthropicProvider, model: 'claude-opus-5-5', unknown: true },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-opus-4-6', unknown: false },
])(
  'pairs every replayed tool call with a result for $provider.id',
  async ({ provider, model, unknown }) => {
    const assistantContent = [
      { type: 'thinking', thinking: 'Checking both sources', signature: 'signature' },
      { type: 'tool_use', id: 'first', name: tool.id, input: {} },
      { type: 'text', text: 'Checking another source.' },
      { type: 'tool_use', id: 'second', name: unknown ? 'missing' : tool.id, input: {} },
    ]
    mocks.claude.mockResolvedValueOnce({
      content: assistantContent,
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    mocks.tool.mockResolvedValueOnce({ success: true, output: { value: 42 } })
    if (!unknown) mocks.tool.mockRejectedValueOnce(new Error('Source unavailable'))

    const result = await provider.executeRequest(
      request(model, {
        thinkingLevel: 'high',
        maxTokens: 4096,
        tools: [tool],
        azureEndpoint: 'https://example.services.ai.azure.com',
      })
    )

    expect(mocks.claude).toHaveBeenCalledTimes(2)
    const followup = mocks.claude.mock.calls[1][0].messages
    expect(followup.at(-2)).toEqual({ role: 'assistant', content: assistantContent })
    expect(
      followup.at(-1).content.map((block: { tool_use_id: string }) => block.tool_use_id)
    ).toEqual(['first', 'second'])
    expect(JSON.parse(followup.at(-1).content[0].content)).toEqual({ value: 42 })
    expect(JSON.parse(followup.at(-1).content[1].content)).toMatchObject({ error: true })
    expect(result).toMatchObject({ content: 'Done' })
  }
)

it.each([
  { provider: anthropicProvider, model: 'claude-haiku-5-5' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-haiku-5-5' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-opus-5' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-opus-4-8' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-opus-4-7' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-opus-4-6' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-sonnet-5' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-sonnet-4-6' },
])(
  'sequences forced tools with adaptive thinking for $model on $provider.id',
  async ({ provider, model }) => {
    const tools = [tool, { ...tool, id: 'verify' }]
    for (const selected of tools) {
      mocks.claude.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: selected.id, name: selected.id, input: {} }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    }
    const result = await provider.executeRequest(
      request(model, {
        thinkingLevel: 'high',
        maxTokens: 1000,
        azureEndpoint: 'https://example.services.ai.azure.com',
        tools: tools.map((selected) => ({ ...selected, usageControl: 'force' })),
      })
    )
    expect(mocks.claude.mock.calls.map(([payload]) => payload.tool_choice)).toEqual([
      { type: 'tool', name: tool.id },
      { type: 'tool', name: 'verify' },
      undefined,
    ])
    for (const [payload] of mocks.claude.mock.calls) {
      expect(payload.thinking).toEqual({ type: 'adaptive' })
      expect(payload.max_tokens).toBe(1000)
    }
    expect(mocks.tool.mock.calls.map(([name]) => name)).toEqual([tool.id, 'verify'])
    expect(result).toMatchObject({ content: 'Done', timing: { iterations: 3 } })
  }
)

const manualThinkingProviders = [
  { provider: anthropicProvider, model: 'claude-haiku-4-5' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-sonnet-4-5' },
]

it.each(manualThinkingProviders)(
  'rejects forced tools with manual thinking for $provider.id',
  async ({ provider, model }) => {
    await expect(
      provider.executeRequest(
        request(model, {
          thinkingLevel: 'low',
          maxTokens: 4096,
          azureEndpoint: 'https://example.services.ai.azure.com',
          tools: [{ ...tool, usageControl: 'force' }],
        })
      )
    ).rejects.toThrow('Manual extended thinking does not support forced tool use')
    expect(mocks.claude).not.toHaveBeenCalled()
    expect(mocks.tool).not.toHaveBeenCalled()
  }
)

const claudeToolProviders = [
  {
    provider: anthropicProvider,
    label: 'Anthropic',
    model: 'claude-haiku-4-5',
    stream: false,
  },
  {
    provider: azureAnthropicProvider,
    label: 'Azure Anthropic',
    model: 'azure-anthropic/claude-sonnet-4-5',
    stream: true,
  },
] as const

it.each(claudeToolProviders)(
  'keeps the completed Claude answer at the tool limit for $provider.id',
  async ({ provider, model, stream }) => {
    const call = { type: 'tool_use', name: tool.id, input: {} }
    const usage = { input_tokens: 10, output_tokens: 5 }
    for (let round = 0; round < MAX_TOOL_ITERATIONS; round++) {
      mocks.claude.mockResolvedValueOnce({
        content: [
          { type: 'text', text: `Working ${round}` },
          { ...call, id: `round-${round}` },
        ],
        usage,
      })
    }
    mocks.claude.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Completed answer' }],
      usage,
    })

    const result = await provider.executeRequest(
      request(model, {
        stream,
        maxTokens: 4096,
        thinkingLevel: 'low',
        tools: [tool],
        azureEndpoint: 'https://example.services.ai.azure.com',
      })
    )
    expect(mocks.claude).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
    for (const [payload] of mocks.claude.mock.calls) expect(payload.max_tokens).toBe(4096)
    expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
    expect(result).toMatchObject({
      content: 'Completed answer',
      tokens: { input: 210, output: 105, total: 315 },
      timing: { iterations: MAX_TOOL_ITERATIONS + 1 },
    })
    if ('stream' in result) throw new Error('Expected completed response')
    expect(result.toolCalls).toHaveLength(MAX_TOOL_ITERATIONS)
    expect(result.toolResults).toHaveLength(MAX_TOOL_ITERATIONS)
  }
)

it.each(claudeToolProviders)(
  'rejects pending Claude tools at the iteration limit for $provider.id',
  async ({ provider, label, model, stream }) => {
    let round = 0
    mocks.claude.mockImplementation(async () => ({
      content: [{ type: 'tool_use', id: `round-${round++}`, name: tool.id, input: {} }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }))

    await expect(
      provider.executeRequest(
        request(model, {
          stream,
          maxTokens: 4096,
          tools: [tool],
          azureEndpoint: 'https://example.services.ai.azure.com',
        })
      )
    ).rejects.toThrow(`${label} exceeded the tool iteration limit`)
    expect(mocks.claude).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
    expect(mocks.tool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
  }
)

it('returns the completed Claude answer when configured tools are unused', async () => {
  const result = await anthropicProvider.executeRequest(
    request('claude-sonnet-5-5', { stream: true, maxTokens: 4096, tools: [tool] })
  )
  expect(mocks.claude).toHaveBeenCalledTimes(1)
  expect(mocks.tool).not.toHaveBeenCalled()
  expect(result).toMatchObject({ content: 'Done', tokens: { total: 15 } })
})

it.each(
  ['claude-haiku-4-5', 'azure-anthropic/claude-haiku-4-5'].flatMap((model) =>
    [false, true].map((stream) => ({ model, stream }))
  )
)('prices uncached context for $model, stream=$stream', async ({ model, stream }) => {
  const usage = { input_tokens: 1000, output_tokens: 100 }
  mocks.claude.mockImplementationOnce(async (payload) =>
    payload.stream
      ? (async function* () {
          yield { type: 'message_start', message: { usage: { ...usage, output_tokens: 0 } } }
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done' } }
          yield { type: 'message_delta', usage: { output_tokens: 100 } }
        })()
      : { content: [{ type: 'text', text: 'Done' }], usage }
  )
  const provider = model.startsWith('azure-anthropic/') ? azureAnthropicProvider : anthropicProvider
  const result = await provider.executeRequest(
    request(model, {
      stream,
      maxTokens: 4096,
      azureEndpoint: 'https://example.services.ai.azure.com',
    })
  )
  if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
  const output = 'stream' in result ? result.execution.output : result
  expect(output).toMatchObject({
    content: 'Done',
    tokens: { input: 1000, output: 100, total: 1100 },
    cost: { input: 0.001, output: 0.0005, total: 0.0015 },
  })
  expect(mocks.claude).toHaveBeenCalledTimes(1)
  expect(mocks.claude.mock.calls[0][0].stream).toBe(stream ? true : undefined)
  expect(mocks.tool).not.toHaveBeenCalled()
})

it('omits Claude tools disabled by usage control', async () => {
  await anthropicProvider.executeRequest(
    request('claude-sonnet-5-5', { tools: [{ ...tool, usageControl: 'none' }], maxTokens: 4096 })
  )
  expect(mocks.claude.mock.calls[0][0].tools).toBeUndefined()
  expect(mocks.claude.mock.calls[0][0].tool_choice).toBeUndefined()
  expect(mocks.tool).not.toHaveBeenCalled()
})

it.each([undefined, 0])('keeps optional Claude temperature %j', async (temperature) => {
  await anthropicProvider.executeRequest(
    request('claude-haiku-4-5', { temperature, maxTokens: 4096 })
  )
  const payload = mocks.claude.mock.calls[0][0]
  expect(payload.temperature).toBe(temperature)
  expect(payload.thinking).toBeUndefined()
})

it.each(manualThinkingProviders)(
  'rejects incompatible manual thinking limits before calling $provider.id',
  async ({ provider, model }) => {
    for (const stream of [false, true]) {
      for (const maxTokens of [1000, 2048]) {
        await expect(
          provider.executeRequest(
            request(model, {
              thinkingLevel: 'low',
              maxTokens,
              stream,
              azureEndpoint: 'https://example.services.ai.azure.com',
            })
          )
        ).rejects.toThrow(`Thinking budget (2048) must be less than maxTokens (${maxTokens})`)
      }
    }
    expect(mocks.claude).not.toHaveBeenCalled()
    expect(mocks.tool).not.toHaveBeenCalled()
  }
)

it.each(manualThinkingProviders)(
  'preserves explicit and default manual thinking limits for $provider.id',
  async ({ provider, model }) => {
    for (const [maxTokens, thinkingLevel, stream] of [
      [2049, 'low', false],
      [4096, 'low', true],
      [undefined, 'high', false],
    ] as const) {
      const result = await provider.executeRequest(
        request(model, {
          maxTokens,
          thinkingLevel,
          stream,
          azureEndpoint: 'https://example.services.ai.azure.com',
        })
      )
      if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
      expect(mocks.claude.mock.calls.at(-1)?.[0]).toMatchObject({
        max_tokens: maxTokens ?? 64000,
        thinking: { type: 'enabled', budget_tokens: thinkingLevel === 'high' ? 32768 : 2048 },
      })
    }
  }
)
