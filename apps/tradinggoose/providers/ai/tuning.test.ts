import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ProviderRequest, ProviderToolConfig } from '@/providers/ai/types'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  claude: vi.fn(),
  gemini: vi.fn(),
  tool: vi.fn(),
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.chat } }
  },
  AzureOpenAI: class {
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
import { azureOpenAIProvider } from '@/providers/ai/azure-openai'
import { MAX_TOOL_ITERATIONS } from '@/providers/ai/constants'
import { deepseekProvider } from '@/providers/ai/deepseek'
import { groqProvider } from '@/providers/ai/groq'
import { ollamaProvider } from '@/providers/ai/ollama'
import { openaiProvider } from '@/providers/ai/openai'

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
  mocks.claude.mockImplementation(async (payload) =>
    payload.stream
      ? (async function* () {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done' } }
        })()
      : { content: [{ type: 'text', text: 'Done' }], usage: { input_tokens: 10, output_tokens: 5 } }
  )
  mocks.tool.mockResolvedValue({ success: true, output: { value: 42 } })
})

it('sends system-only requests once through Claude and Bedrock SDK adapters', async () => {
  const systemPrompt = 'Analyze prices'
  await executeProviderRequest('anthropic', {
    model: 'claude-sonnet-5',
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
  expect(result.cost?.total).toBeCloseTo(2.000156, 8)
})

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
    provider: openaiProvider,
    model: 'gpt-5.6-sol',
    params: { maxTokens: 4096 },
    expected: { max_completion_tokens: 4096 },
  },
  {
    provider: azureOpenAIProvider,
    model: 'azure/gpt-5.4',
    params: { maxTokens: 4096 },
    expected: { max_completion_tokens: 4096 },
  },
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

  const result = await deepseekProvider.executeRequest(
    request('deepseek-v4-flash', { tools: [tool] })
  )
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
    deepseekProvider.executeRequest(request('deepseek-v4-flash', { tools: [tool] }))
  ).rejects.toThrow('DeepSeek unavailable')
  expect(mocks.chat).toHaveBeenCalledTimes(2)
})

it.each([
  {
    provider: anthropicProvider,
    model: 'claude-opus-4-6',
    stream: false,
    streamToolCalls: false,
  },
  {
    provider: azureAnthropicProvider,
    model: 'azure-anthropic/claude-opus-4-6',
    stream: true,
    streamToolCalls: false,
  },
  {
    provider: anthropicProvider,
    model: 'claude-sonnet-5',
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
  { provider: anthropicProvider, model: 'claude-opus-4-6', unknown: true },
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
  { provider: anthropicProvider, model: 'claude-sonnet-5' },
  { provider: azureAnthropicProvider, model: 'azure-anthropic/claude-opus-4-6' },
])(
  'sequences forced tools with adaptive thinking for $provider.id',
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
  { provider: anthropicProvider, model: 'claude-sonnet-4-5' },
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
  { provider: anthropicProvider, model: 'claude-sonnet-4-5', stream: false },
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
    request('claude-sonnet-5', { stream: true, maxTokens: 4096, tools: [tool] })
  )
  expect(mocks.claude).toHaveBeenCalledTimes(1)
  expect(mocks.tool).not.toHaveBeenCalled()
  expect(result).toMatchObject({ content: 'Done', tokens: { total: 15 } })
})

it('streams Claude text when tools are absent', async () => {
  const result = await anthropicProvider.executeRequest(
    request('claude-sonnet-5', { stream: true, maxTokens: 4096 })
  )
  if (!('stream' in result)) throw new Error('Expected streaming execution')
  expect(await new Response(result.stream).text()).toBe('Done')
  expect(mocks.claude).toHaveBeenCalledTimes(1)
  expect(mocks.claude.mock.calls[0][0].stream).toBe(true)
  expect(mocks.tool).not.toHaveBeenCalled()
})

it('omits Claude tools disabled by usage control', async () => {
  await anthropicProvider.executeRequest(
    request('claude-sonnet-5', { tools: [{ ...tool, usageControl: 'none' }], maxTokens: 4096 })
  )
  expect(mocks.claude.mock.calls[0][0].tools).toBeUndefined()
  expect(mocks.claude.mock.calls[0][0].tool_choice).toBeUndefined()
  expect(mocks.tool).not.toHaveBeenCalled()
})

it.each([undefined, 0])('keeps optional Claude temperature %j', async (temperature) => {
  await anthropicProvider.executeRequest(
    request('claude-sonnet-4-5', { temperature, maxTokens: 4096 })
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
