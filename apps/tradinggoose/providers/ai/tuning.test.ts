import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ProviderId, ProviderRequest, ProviderToolConfig } from '@/providers/ai/types'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  responses: vi.fn(),
  claude: vi.fn(),
  gemini: vi.fn(),
  tool: vi.fn(),
}))
vi.mock('openai', () => ({
  default: class {
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
    models = { generateContent: mocks.gemini }
  },
}))
vi.mock('@/tools', () => ({ executeTool: mocks.tool }))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureOpenAIServiceConfig: async () => ({ endpoint: 'https://example.openai.azure.com' }),
  resolveOllamaServiceConfig: async () => ({ baseUrl: 'http://ollama:11434' }),
}))

import { GET as discoverOllamaModels } from '@/app/api/providers/ai/ollama/models/route'
import { executeProviderRequest } from '@/providers/ai'
import { anthropicProvider } from '@/providers/ai/anthropic'
import { azureAnthropicProvider } from '@/providers/ai/azure-anthropic'
import { MAX_TOOL_ITERATIONS } from '@/providers/ai/constants'
import { deepseekProvider } from '@/providers/ai/deepseek'
import { groqProvider } from '@/providers/ai/groq'
import { ollamaProvider } from '@/providers/ai/ollama'

const request = (model: string, params: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model,
  apiKey: 'test-key',
  context: 'Analyze',
  ...params,
})
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
  message = { role: 'assistant', content: 'Done' } as Record<string, unknown>
) => ({
  choices: [{ message }],
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
function respond(...turns: ReturnType<typeof response>[]) {
  mocks.responses.mockReset()
  for (const turn of turns) {
    mocks.responses.mockImplementationOnce(async (payload) =>
      payload.stream
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
    )
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

it('reads actual Groq stream usage from the terminal x_groq chunk', async () => {
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
    request('groq/llama-3.3-70b-versatile', {
      context: undefined,
      messages: [{ role: 'user', content: 'Analyze' }],
      stream: true,
    })
  )
  if (!('stream' in result)) throw new Error('Expected streaming execution')
  expect(await new Response(result.stream).text()).toBe('Done')
  expect(result.execution.output.tokens).toEqual({ prompt: 1000, completion: 500, total: 1500 })
  expect(result.execution.output.cost?.input).toBeCloseTo(0.00059, 8)
  expect(result.execution.output.cost?.output).toBeCloseTo(0.000395, 8)
  expect(result.execution.output.cost?.total).toBeCloseTo(0.000985, 8)
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
  ['mistral', 'mistral-large-latest', 10000, 0.5, 1.5],
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
  ['mistral', 'mistral-large-latest', 10000, 0.5, 1.5],
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
    request('mistral-large-latest', { stream: true })
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
  expect(result.execution.output.cost?.total).toBeCloseTo(inputTokens ? 0.00065 : 0, 8)
  expect(mocks.chat).toHaveBeenCalledTimes(1)
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

it.each([
  {
    provider: groqProvider,
    model: 'groq/qwen/qwen3.6-27b',
    params: { thinkingLevel: 'enabled' },
    expected: { reasoning_effort: 'default', reasoning_format: 'parsed' },
  },
  {
    provider: deepseekProvider,
    model: 'deepseek-v4-pro',
    params: { thinkingLevel: 'none', reasoningEffort: 'max' },
    expected: { thinking: { type: 'disabled' } },
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
      ...turns.map((turn, index) => ({
        ...turn,
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
      mocks.chat.mockResolvedValueOnce(completion({ tool_calls: [toolCall('next')] }))
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
  }
)

const cachedChatModels = [
  ['deepseek', 'deepseek-flash', 0.0003, 0.000153, 0.000006, 0.00012],
  ['deepseek', 'deepseek-v4-pro', 0.00132, 0.000682, 0.000044, 0.000396],
  ['xai', 'grok-4.6', 0.002, 0.00125, 0.0005, 0.0006],
  ['mistral', 'mistral-large-4', 0.00068, 0.000375, 0.00007, 0.000209],
  ['groq', 'groq/openai/gpt-oss-120b', 0.00015, 0.0001125, 0.000075, 0.00006],
  ['fireworks', 'fireworks/accounts/fireworks/models/glm-5p3', 0.0014, 0.00083, 0.00026, 0.00044],
] as const

it.each(
  cachedChatModels.flatMap(([provider, model, cold, partial, cached, outputCost]) =>
    (
      [
        [undefined, cold],
        [0, cold],
        [500, partial],
        [1000, cached],
      ] as const
    ).flatMap(([cachedTokens, inputCost]) =>
      [false, true].map((stream) => ({
        provider,
        model,
        cachedTokens,
        inputCost,
        outputCost,
        stream,
      }))
    )
  )
)(
  'prices $model reported cache hits=$cachedTokens, stream=$stream',
  async ({ provider, model, cachedTokens, inputCost, outputCost, stream }) => {
    const usage = {
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      ...(cachedTokens === undefined
        ? {}
        : provider === 'deepseek'
          ? { prompt_cache_hit_tokens: cachedTokens }
          : { prompt_tokens_details: { cached_tokens: cachedTokens } }),
    }
    mocks.chat.mockResolvedValueOnce(
      stream
        ? (async function* () {
            yield { choices: [{ delta: { content: 'Done' } }] }
            yield provider === 'groq' ? { choices: [], x_groq: { usage } } : { choices: [], usage }
          })()
        : { ...completion(), usage }
    )
    const result = await executeProviderRequest(provider, request(model, { stream }))
    if ('stream' in result) expect(await new Response(result.stream).text()).toBe('Done')
    const output = 'stream' in result ? result.execution.output : result
    expect(output.tokens).toEqual({ prompt: 1000, completion: 100, total: 1100 })
    expect(output.cost.input).toBeCloseTo(inputCost, 8)
    expect(output.cost.output).toBeCloseTo(outputCost, 8)
    expect(output.cost.total).toBeCloseTo(inputCost + outputCost, 8)
  }
)

it.each(
  cachedChatModels.flatMap(([provider, model, cold, partial, cached, outputCost]) =>
    [false, true].map((stream) => ({ provider, model, cold, partial, cached, outputCost, stream }))
  )
)(
  'preserves $model cached usage across tool turns, stream=$stream',
  async ({ provider, model, cold, partial, cached, outputCost, stream }) => {
    const usages = [0, 500, 1000].map((cachedTokens) => ({
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      ...(provider === 'deepseek'
        ? { prompt_cache_hit_tokens: cachedTokens }
        : { prompt_tokens_details: { cached_tokens: cachedTokens } }),
    }))
    const content = provider === 'fireworks' ? '{"value":42}' : 'Done'
    mocks.chat
      .mockResolvedValueOnce({
        ...completion({ role: 'assistant', content: null, tool_calls: [toolCall('cached-tool')] }),
        usage: usages[0],
      })
      .mockResolvedValueOnce({ ...completion(), usage: usages[1] })
      .mockResolvedValueOnce(
        stream
          ? (async function* () {
              yield { choices: [{ delta: { content } }] }
              yield provider === 'groq'
                ? { choices: [], x_groq: { usage: usages[2] } }
                : { choices: [], usage: usages[2] }
            })()
          : { ...completion({ role: 'assistant', content }), usage: usages[2] }
      )
    mocks.tool.mockResolvedValueOnce({ success: true, output: { cost: { total: 2 } } })
    const result = await executeProviderRequest(
      provider,
      request(model, {
        stream,
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
    const calls = stream || provider === 'fireworks' ? 3 : 2
    expect(output.tokens).toEqual({
      prompt: calls * 1000,
      completion: calls * 100,
      total: calls * 1100,
    })
    const inputCost = cold + partial + (calls === 3 ? cached : 0)
    expect(output.cost.input).toBeCloseTo(inputCost, 8)
    expect(output.cost.output).toBeCloseTo(outputCost * calls, 8)
    expect(output.cost.toolCost).toBe(2)
    expect(output.cost.total).toBeCloseTo(2 + inputCost + outputCost * calls, 8)
    expect(mocks.chat).toHaveBeenCalledTimes(calls)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
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
      expect(payload.thinking).toEqual({ type: 'disabled' })
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
      thinkingLevel: 'enabled',
      reasoningEffort: 'max',
      tools: [tool],
    })
  )
  expect(mocks.tool).toHaveBeenCalledTimes(2)
  expect(mocks.chat).toHaveBeenCalledTimes(2)
  for (const [payload] of mocks.chat.mock.calls) {
    expect(controls(payload)).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'max' })
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

it.each([
  { provider: anthropicProvider, model: 'claude-haiku-4-5', stream: false },
  {
    provider: azureAnthropicProvider,
    model: 'azure-anthropic/claude-sonnet-4-5',
    stream: true,
  },
])(
  'keeps the latest Claude answer at the tool limit for $provider.id',
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
      content: [
        { type: 'text', text: 'Completed answer' },
        ...(stream ? [{ ...call, id: 'over-limit' }] : []),
      ],
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
