import type { GoogleGenAI } from '@google/genai'
import { beforeEach, expect, it, vi } from 'vitest'
import { MAX_TOOL_ITERATIONS } from '@/providers/ai/constants'
import { executeGeminiRequest } from '@/providers/ai/gemini/core'
import type { ProviderToolConfig } from '@/providers/ai/types'

const mocks = vi.hoisted(() => ({ executeTool: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: mocks.executeTool }))

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

beforeEach(() => {
  vi.resetAllMocks()
  mocks.executeTool.mockResolvedValue({ success: true, output: { value: 42, cost: { total: 2 } } })
})

it('delivers final Gemini answer chunks before generation completes and retains tool accounting', async () => {
  let release!: () => void
  const completion = new Promise<void>((resolve) => {
    release = resolve
  })
  const generateContent = vi
    .fn()
    .mockResolvedValueOnce(call())
    .mockResolvedValueOnce(answer('Settled answer', 20))
  const generateContentStream = vi.fn(async function* (_payload: Record<string, any>) {
    yield answer('Visible ', 30)
    await completion
    yield answer('answer', 30)
  })
  const result = await executeGeminiRequest({
    ai: { models: { generateContent, generateContentStream } } as unknown as GoogleGenAI,
    model: 'gemini-2.5-flash',
    providerType: 'google',
    request: { model: 'gemini-2.5-flash', context: 'Analyze', tools: [tool], stream: true },
  })
  if (!('stream' in result)) throw new Error('Expected a streaming result')
  expect(generateContentStream).toHaveBeenCalledTimes(1)
  expect(generateContent).toHaveBeenCalledTimes(2)
  const payload = generateContentStream.mock.calls[0][0]
  expect(payload.config.tools).toBeUndefined()
  expect(payload.config.toolConfig).toBeUndefined()
  expect(payload.contents).toContainEqual(answer('Settled answer', 20).candidates[0].content)

  const reader = result.stream.getReader()
  try {
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('Visible ')
    expect(first.done).toBe(false)
  } finally {
    release()
  }
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('answer')
  expect((await reader.read()).done).toBe(true)
  expect(result.execution.output).toMatchObject({
    content: 'Visible answer',
    tokens: { input: 60, output: 15, total: 75 },
    toolCalls: { count: 1 },
    cost: { toolCost: 2, total: expect.any(Number) },
    providerTiming: { iterations: 3 },
  })
  expect(result.execution.output.cost?.total).toBeGreaterThan(2)
})

it.each([false, true])('synthesizes Gemini 2 JSON after auto tools, stream=%s', async (stream) => {
  const schema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }
  const settled = answer('The value is 42')
  const generateContent = vi
    .fn()
    .mockResolvedValueOnce(call())
    .mockResolvedValueOnce(settled)
    .mockResolvedValueOnce(answer('{"value":42}'))
  const generateContentStream = vi.fn(async function* (_payload: Record<string, any>) {
    yield answer('{"value":')
    yield answer('42}')
  })
  const result = await executeGeminiRequest({
    ai: { models: { generateContent, generateContentStream } } as unknown as GoogleGenAI,
    model: 'gemini-2.5-flash',
    providerType: 'google',
    request: {
      model: 'gemini-2.5-flash',
      context: 'Analyze',
      tools: [tool],
      responseFormat: { schema },
      stream,
    },
  })
  const content = 'stream' in result ? await new Response(result.stream).text() : result.content
  expect(JSON.parse(content)).toEqual({ value: 42 })
  const payload = stream ? generateContentStream.mock.calls[0][0] : generateContent.mock.calls[2][0]
  expect(payload.config).toMatchObject({
    responseMimeType: 'application/json',
    responseSchema: schema,
  })
  expect(payload.config.tools).toBeUndefined()
  expect(payload.config.toolConfig).toBeUndefined()
  expect(payload.contents).toContainEqual(settled.candidates[0].content)
})

it.each(['missing', 'throws'])(
  'returns an all-%s tool batch to Gemini as error results',
  async (failure) => {
    const initial = call(failure === 'missing' ? 'unknown' : tool.id)
    if (failure === 'throws') mocks.executeTool.mockRejectedValueOnce(new Error('Unavailable'))
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(answer('Recovered'))
    const result = await executeGeminiRequest({
      ai: { models: { generateContent } } as unknown as GoogleGenAI,
      model: 'gemini-2.5-flash',
      providerType: 'google',
      request: { model: 'gemini-2.5-flash', context: 'Analyze', tools: [tool] },
    })
    expect(result).toMatchObject({
      content: 'Recovered',
      toolCalls: [{ name: failure === 'missing' ? 'unknown' : tool.id, result: { error: true } }],
    })
    expect(mocks.executeTool).toHaveBeenCalledTimes(failure === 'missing' ? 0 : 1)
    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(generateContent.mock.calls[1][0].contents.slice(-2)).toEqual([
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

it('retains completed Gemini usage and tool costs when pending calls exceed the limit', async () => {
  const generateContent = vi.fn().mockResolvedValue(call())
  await expect(
    executeGeminiRequest({
      ai: { models: { generateContent } } as unknown as GoogleGenAI,
      model: 'gemini-2.5-flash',
      providerType: 'google',
      request: { model: 'gemini-2.5-flash', context: 'Analyze', tools: [tool] },
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
  expect(generateContent).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1)
  expect(mocks.executeTool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
})
