import { beforeEach, expect, it, vi } from 'vitest'
import { handleAIProviderRequest } from '@/app/api/providers/ai/handler'
import { openaiProvider } from '@/providers/ai/openai'
import { decodeProviderStream } from '@/providers/ai/streaming'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), responses: vi.fn(), tool: vi.fn() }))
vi.mock('@/providers/ai', () => ({ executeProviderRequest: mocks.execute }))
vi.mock('@/providers/ai/utils-server', () => ({ getApiKey: async () => 'test-key' }))
vi.mock('@/tools', () => ({ executeTool: mocks.tool }))
vi.mock('openai', () => ({
  default: class {
    responses = { create: mocks.responses }
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.execute.mockImplementation((_provider, request) => openaiProvider.executeRequest(request))
})

it.each([false, true])('preserves completed OpenAI HTTP metadata, tools=%s', async (withTools) => {
  let finishTool!: () => void
  let startTool!: () => void
  const pendingTool = new Promise<void>((resolve) => {
    finishTool = resolve
  })
  const startedTool = new Promise<void>((resolve) => {
    startTool = resolve
  })
  mocks.tool.mockImplementationOnce(async () => {
    startTool()
    await pendingTool
    return { success: true, output: { quote: '股票 📈', cost: { total: 2 } } }
  })
  mocks.responses.mockImplementation(async (payload) => {
    const done =
      !withTools ||
      payload.input.some((item: { type: string }) => item.type === 'function_call_output')
    const response = {
      status: 'completed',
      output: done
        ? [{ type: 'message', content: [{ type: 'output_text', text: '价格 📈' }] }]
        : [
            {
              type: 'function_call',
              call_id: 'price-call',
              name: 'lookup',
              arguments: '{"symbol":"你好"}',
            },
          ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }
    return (async function* () {
      if (done) yield { type: 'response.output_text.delta', delta: '价格 📈' }
      yield { type: 'response.completed', response }
    })()
  })

  const response = await handleAIProviderRequest({
    providerId: 'openai',
    requestId: 'http-metadata-test',
    startTime: Date.now(),
    authUserId: 'user',
    body: {
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'Get prices' }],
      stream: true,
      tools: withTools
        ? [
            {
              id: 'lookup',
              name: 'Get prices',
              description: 'Get prices',
              params: {},
              parameters: {
                type: 'object',
                properties: { symbol: { type: 'string' } },
                required: ['symbol'],
              },
            },
          ]
        : undefined,
    },
  })
  expect(response.headers.get('Content-Type')).toContain('text/event-stream')
  expect(response.headers.has('X-Execution-Data')).toBe(false)
  if (!response.body) throw new Error('Expected HTTP stream body')
  const decoded = decodeProviderStream(response.body)
  const output = decoded.execution.output
  const metadata = decoded.execution.metadata
  const content = new Response(decoded.stream).text()
  if (withTools) {
    await startedTool
    expect(output.toolCalls).toBeUndefined()
    finishTool()
  }
  expect(await content).toBe('价格 📈')
  expect(decoded.execution.output).toBe(output)
  expect(decoded.execution.metadata).toBe(metadata)
  const calls = withTools ? 2 : 1
  expect(output).toMatchObject({
    content: '价格 📈',
    tokens: { prompt: 10 * calls, completion: 5 * calls, total: 15 * calls },
    providerTiming: { iterations: calls, timeSegments: expect.any(Array) },
  })
  expect(metadata).toMatchObject({ startTime: expect.any(String), endTime: expect.any(String) })
  expect(output.cost.total).toBeCloseTo((withTools ? 2 : 0) + calls * 0.00007, 8)
  if (withTools)
    expect(output.toolCalls).toMatchObject({
      count: 1,
      list: [
        {
          id: 'price-call',
          name: 'lookup',
          arguments: { symbol: '你好' },
          result: { quote: '股票 📈' },
          success: true,
        },
      ],
    })
  expect(mocks.responses).toHaveBeenCalledTimes(calls)
})
