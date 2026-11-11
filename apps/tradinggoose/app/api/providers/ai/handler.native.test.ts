import { afterEach, expect, it, vi } from 'vitest'
import { handleAIProviderRequest } from './handler'

vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))
vi.mock('@/lib/mastra/usage-processors', () => ({
  usageProcessors: async () => ({
    inputProcessors: [],
    outputProcessors: [],
    getUsage: () => ({}),
    getCost: () => ({ status: 'unavailable' as const }),
    verifyComplete: async () => {},
  }),
}))
vi.mock('@/blocks', () => ({ getAllBlocks: () => [] }))
vi.mock('@/tools', () => ({ executeTool: vi.fn(), getToolAsync: vi.fn() }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it.each([401, 429, 500])(
  'keeps installed native adapter diagnostics out of public HTTP %s errors with one contact',
  async (status) => {
    const credential = 'fixture-upstream-private-credential'
    const privateRequest = 'fixture-private-request-value'
    vi.stubEnv('OPENAI_API_KEY', credential)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: {
            message: 'Upstream rejected the request',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
          privateDiagnostic: credential,
        },
        { status, headers: { 'x-upstream-private': credential } }
      )
    )
    vi.stubGlobal('fetch', fetcher)

    const response = await handleAIProviderRequest({
      body: {
        model: 'openai/gpt-4.1',
        messages: [{ role: 'user', content: privateRequest }],
        stream: true,
        modelSettings: { maxRetries: 0 },
      },
      requestId: 'installed-adapter-error',
    })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    let failure: unknown
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        text += decoder.decode(chunk.value, { stream: true })
      }
    } catch (error) {
      failure = error
    }

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(request.headers).get('authorization')).toBe(`Bearer ${credential}`)
    expect(request.body).toContain(privateRequest)
    const events = text
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)))
    expect(events).toContainEqual({
      type: 'error',
      payload: { error: 'Upstream rejected the request' },
    })
    expect(text).not.toMatch(/responseHeaders|responseBody|requestBodyValues|stack/)
    expect(text).not.toContain(credential)
    expect(JSON.stringify(events.find((event) => event.type === 'error'))).not.toContain(
      privateRequest
    )
    expect(text).not.toContain('workflow-output')
    expect(failure).toMatchObject({
      model: 'openai/gpt-4.1',
      cost: { status: 'unavailable' },
    })
  }
)
