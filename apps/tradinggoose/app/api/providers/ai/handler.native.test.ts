import { NextRequest } from 'next/server'
import { afterEach, expect, it, vi } from 'vitest'
import { POST } from '../route'

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
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: async () => ({ success: true, userId: 'actor' }),
}))
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

    const response = await POST(
      new NextRequest('http://localhost/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          providerNamespace: 'ai',
          model: 'openai/gpt-4.1',
          messages: [{ role: 'user', content: privateRequest }],
          modelSettings: { maxRetries: 0 },
        }),
      })
    )
    const text = await response.text()
    expect(response.status).toBe(500)

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(request.headers).get('authorization')).toBe(`Bearer ${credential}`)
    expect(request.body).toContain(privateRequest)
    expect(JSON.parse(text)).toEqual({
      error: 'Upstream rejected the request',
      model: 'openai/gpt-4.1',
      tokens: {},
      cost: { status: 'unavailable' },
    })
    expect(text).not.toMatch(/responseHeaders|responseBody|requestBodyValues|stack/)
    expect(text).not.toContain(credential)
    expect(text).not.toContain(privateRequest)
  }
)
