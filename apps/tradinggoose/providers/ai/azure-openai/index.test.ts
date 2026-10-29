import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), config: vi.fn() }))
vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>()
  return {
    ...actual,
    default: class extends actual.default {
      constructor(options: ConstructorParameters<typeof actual.default>[0]) {
        super({ ...options, fetch: mocks.fetch, maxRetries: 0 })
      }
    },
    AzureOpenAI: class extends actual.AzureOpenAI {
      constructor(options: ConstructorParameters<typeof actual.AzureOpenAI>[0]) {
        super({ ...options, fetch: mocks.fetch, maxRetries: 0 })
      }
    },
  }
})
vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureOpenAIServiceConfig: mocks.config,
}))

import { azureOpenAIProvider } from '@/providers/ai/azure-openai'

const completion = {
  id: 'resp_azure',
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.config.mockResolvedValue({
    endpoint: 'https://default.openai.azure.com/',
    apiKey: 'service-key',
    apiVersion: '2025-04-01-preview',
  })
  mocks.fetch.mockImplementation(async (_url, init) =>
    JSON.parse(init.body).stream
      ? new Response(
          [
            { type: 'response.output_text.delta', delta: 'Done' },
            { type: 'response.completed', response: completion },
          ]
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(''),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      : Response.json(completion)
  )
})

it.each([false, true])('uses the Azure v1 Responses endpoint, stream=%s', async (stream) => {
  const result = await azureOpenAIProvider.executeRequest({
    model: 'azure/gpt-6.1-sol',
    context: 'Analyze',
    maxTokens: 100,
    reasoningEffort: 'max',
    stream,
    ...(stream && {
      azureEndpoint: 'https://override.openai.azure.com',
      apiKey: 'request-key',
    }),
  })
  if ('stream' in result) {
    expect(await new Response(result.stream).text()).toBe('Done')
    expect(result.execution.output.tokens).toEqual({ prompt: 10, completion: 5, total: 15 })
  } else {
    expect(result).toMatchObject({ content: 'Done', model: 'azure/gpt-6.1-sol' })
  }
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  const [url, init] = mocks.fetch.mock.calls[0]
  expect(String(url)).toBe(
    `https://${stream ? 'override' : 'default'}.openai.azure.com/openai/v1/responses`
  )
  expect(new Headers(init.headers).get('authorization')).toBe(
    `Bearer ${stream ? 'request-key' : 'service-key'}`
  )
  expect(JSON.parse(init.body)).toMatchObject({
    model: 'gpt-6.1-sol',
    max_output_tokens: 100,
    reasoning: { effort: 'max' },
    stream,
  })
})

it('rejects a missing Azure endpoint before sending a request', async () => {
  mocks.config.mockResolvedValue({})
  await expect(
    azureOpenAIProvider.executeRequest({ model: 'azure/gpt-6.1-sol', context: 'Analyze' })
  ).rejects.toThrow('Azure OpenAI endpoint is required')
  expect(mocks.fetch).not.toHaveBeenCalled()
})
