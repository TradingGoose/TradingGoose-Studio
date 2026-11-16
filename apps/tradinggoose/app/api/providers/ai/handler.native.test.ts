import { NextRequest } from 'next/server'
import { afterEach, expect, it, vi } from 'vitest'
import { managedServices } from '@/lib/mastra/__test-utils__/managed-services'
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

it.each([
  {
    model: 'anthropic/claude-sonnet-4-5',
    providerOptions: {
      anthropic: {
        mcpServers: [
          {
            type: 'url',
            name: 'unapproved',
            url: 'https://mcp.example.test',
            authorizationToken: 'private-token',
            toolConfiguration: { enabled: true },
          },
        ],
      },
    },
    error: 'Invalid AI provider request',
  },
  ...[
    'lmstudio/openai/gpt-oss-20b',
    'privatemode-ai/glm-5.3',
    'lynkr/lynkr-auto',
    'atomic-chat/Meta-Llama-3_1-8B-Instruct-GGUF',
  ].map((model) => ({
    model,
    apiKey: 'arbitrary-key',
    error: expect.stringContaining('Select a listed provider/model'),
  })),
])('rejects unsupported access for $model before provider contact', async ({ error, ...body }) => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const response = await POST(
    new NextRequest('http://localhost/api/providers', {
      method: 'POST',
      body: JSON.stringify({ providerNamespace: 'ai', ...body }),
    })
  )
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error })
  expect(managedServices.readConfig).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([401, 429, 500])(
  'keeps installed native adapter diagnostics out of public HTTP %s errors',
  async (status) => {
    const credential = 'fixture-upstream-private-credential'
    const privateRequest = 'fixture-private-request-value'
    managedServices.credentials.openai = { defaultApiKey: credential }
    vi.stubEnv('OPENAI_API_KEY', 'ignored-environment-credential')
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
        }),
      })
    )
    const text = await response.text()
    expect(response.status).toBe(500)

    expect(fetcher).toHaveBeenCalled()
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
