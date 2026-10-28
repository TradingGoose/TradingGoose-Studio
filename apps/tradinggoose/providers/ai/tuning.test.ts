import { beforeEach, expect, it, vi } from 'vitest'
import type { ProviderRequest, ProviderToolConfig } from '@/providers/ai/types'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  claude: vi.fn(),
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
vi.mock('@/tools', () => ({ executeTool: mocks.tool }))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureOpenAIServiceConfig: async () => ({ endpoint: 'https://example.openai.azure.com' }),
  resolveOllamaServiceConfig: async () => ({ baseUrl: 'http://ollama:11434' }),
}))

import { GET as discoverOllamaModels } from '@/app/api/providers/ai/ollama/models/route'
import { anthropicProvider } from '@/providers/ai/anthropic'
import { azureOpenAIProvider } from '@/providers/ai/azure-openai'
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
  { stream: false, streamToolCalls: false },
  { stream: true, streamToolCalls: false },
  { stream: true, streamToolCalls: true },
])(
  'keeps native Claude tool behavior for stream=$stream, streamToolCalls=$streamToolCalls',
  async (mode) => {
    const thinking = { type: 'thinking', thinking: 'Checking data', signature: 'signature' }
    const call = { type: 'tool_use', id: 'next', name: tool.id, input: {} }
    mocks.claude.mockResolvedValueOnce({
      content: [thinking, call],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const result = await anthropicProvider.executeRequest(
      request('claude-sonnet-5', {
        stream: mode.stream,
        streamToolCalls: mode.streamToolCalls,
        messages: history,
        maxTokens: 4096,
        thinkingLevel: 'high',
        tools: [{ ...tool, usageControl: 'force' }],
        responseFormat: { name: 'result', schema: { type: 'object', properties: {} } },
      })
    )
    expect(mocks.tool).toHaveBeenCalledWith(tool.id, expect.any(Object))
    expect(mocks.claude).toHaveBeenCalledTimes(2)
    const initial = mocks.claude.mock.calls[0][0]
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
      expect(payload.tool_choice).toBeUndefined()
    }
    const followup = mocks.claude.mock.calls[1][0].messages
    expect(followup.at(-2).content).toEqual([thinking, call])
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

it.each([undefined, 0])('keeps optional Claude temperature %j', async (temperature) => {
  await anthropicProvider.executeRequest(
    request('claude-sonnet-4-5', { temperature, maxTokens: 4096 })
  )
  const payload = mocks.claude.mock.calls[0][0]
  expect(payload.temperature).toBe(temperature)
  expect(payload.thinking).toBeUndefined()
})

it('keeps budget thinking for active Claude 4.5 models', async () => {
  await anthropicProvider.executeRequest(
    request('claude-sonnet-4-5', { thinkingLevel: 'low', maxTokens: 4096 })
  )
  expect(mocks.claude.mock.calls[0][0]).toMatchObject({
    thinking: { type: 'enabled', budget_tokens: 2048 },
  })
})
