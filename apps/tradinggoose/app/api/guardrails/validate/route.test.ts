import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validatePII } from '@/lib/guardrails/validate_pii'
import { createMockRequest, mockConsoleLogger } from '@/app/api/__test-utils__/utils'
import { executeProviderRequest } from '@/providers/ai'

vi.mock('@/providers/ai', () => ({ executeProviderRequest: vi.fn() }))
vi.mock('@/providers/ai/utils', () => ({ getProviderFromModel: () => 'openai' }))
vi.mock('@/providers/ai/utils-server', () => ({ getApiKey: async () => 'model-api-key' }))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://studio.test' }))
vi.mock('@/lib/utils', () => ({ generateRequestId: () => 'guardrail-test' }))
vi.mock('@/lib/guardrails/validate_pii', () => ({ validatePII: vi.fn() }))
mockConsoleLogger()

const input = {
  validationType: 'hallucination',
  input: 'The answer is grounded.',
  knowledgeBaseId: 'knowledge-1',
  workflowId: 'workflow-1',
  model: 'gpt-4o',
}

describe('guardrail validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(executeProviderRequest).mockResolvedValue({
      content: JSON.stringify({ score: 9, reasoning: 'Supported by the context.' }),
    } as Awaited<ReturnType<typeof executeProviderRequest>>)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const headers = new Headers(init.headers)
        const authenticated =
          !headers.has('x-api-key') &&
          (headers.get('authorization') === 'Bearer execution-token' ||
            headers.get('cookie') === 'session=actor-session')
        return Response.json(
          authenticated
            ? { data: { results: [{ content: 'Grounded knowledge context.' }] } }
            : { error: 'Unauthorized' },
          { status: authenticated ? 200 : 401 }
        )
      })
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each<Record<string, string>>([
    { authorization: 'Bearer execution-token' },
    { cookie: 'session=actor-session' },
  ])('forwards $authorization $cookie to search before scoring', async (credentials) => {
    const { POST } = await import('./route')
    const response = await POST(
      createMockRequest('POST', input, { ...credentials, 'x-unrelated': 'not-forwarded' })
    )

    expect(await response.json()).toMatchObject({ output: { passed: true, score: 9 } })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://studio.test/api/knowledge/search')
    expect(init?.redirect).toBe('error')
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      'content-type': 'application/json',
      ...credentials,
    })
    expect(JSON.parse(init?.body as string)).toEqual({
      knowledgeBaseIds: ['knowledge-1'],
      query: input.input,
      topK: 10,
      workflowId: 'workflow-1',
    })
    expect(executeProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        messages: [
          { role: 'user', content: expect.stringContaining('Grounded knowledge context.') },
        ],
      })
    )
  })

  it.each<Record<string, string>>([
    {},
    { cookie: 'session=actor-session', 'x-api-key': 'unsupported-api-key' },
  ])('does not replace rejected credentials with a workflow owner', async (headers) => {
    const { POST } = await import('./route')
    const response = await POST(
      createMockRequest(
        'POST',
        { ...input, authHeaders: { authorization: 'Bearer execution-token' } },
        headers
      )
    )

    expect(await response.json()).toMatchObject({
      output: { passed: false, error: 'Validation error: Knowledge base query failed (401)' },
    })
    expect(executeProviderRequest).not.toHaveBeenCalled()
  })

  it.each<[Record<string, unknown>, string]>([
    [{}, 'Missing required field: validationType'],
    [{ validationType: 'json' }, 'Input is missing or undefined'],
    [{ validationType: 'json', input: null }, 'Input is missing or undefined'],
    [
      { validationType: 'unknown', input: '' },
      'Invalid validationType. Must be "json", "regex", "hallucination", or "pii"',
    ],
    [{ validationType: 'regex', input: '' }, 'Regex pattern is required for regex validation'],
    [{ ...input, model: undefined }, 'Model is required for hallucination validation'],
    [
      { ...input, knowledgeBaseId: undefined },
      'Knowledge base ID is required for hallucination check',
    ],
  ])('preserves preflight rejection for %j', async (body, error) => {
    const { POST } = await import('./route')
    const response = await POST(createMockRequest('POST', body))
    expect(await response.json()).toMatchObject({ success: true, output: { passed: false, error } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each<[Record<string, unknown>, boolean]>([
    [{ validationType: 'json', input: { valid: true } }, true],
    [{ validationType: 'json', input: '{' }, false],
    [{ validationType: 'regex', input: 12, regex: '^12$' }, true],
    [{ validationType: 'regex', input: false, regex: '^true$' }, false],
  ])('preserves input conversion and dispatch for %j', async (body, passed) => {
    const { POST } = await import('./route')
    const response = await POST(createMockRequest('POST', body))
    expect(await response.json()).toMatchObject({ output: { passed, input: body.input } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([{}, { piiMode: 'mask', piiLanguage: 'es', piiEntityTypes: ['PERSON'] }])(
    'preserves PII options and result fields for %j',
    async (options) => {
      const { POST } = await import('./route')
      const result = { passed: true, detectedEntities: [], maskedText: 'masked' }
      vi.mocked(validatePII).mockResolvedValue(result)
      const response = await POST(
        createMockRequest('POST', { validationType: 'pii', input: 'text', ...options })
      )
      expect(await response.json()).toMatchObject({ output: result })
      expect(validatePII).toHaveBeenCalledWith({
        text: 'text',
        entityTypes: options.piiEntityTypes || [],
        mode: options.piiMode || 'block',
        language: options.piiLanguage || 'en',
        requestId: 'guardrail-test',
      })
    }
  )

  it('reserves empty-context failure for a successful search with no results', async () => {
    const { POST } = await import('./route')
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { results: [] } }))
    const response = await POST(
      createMockRequest('POST', input, { authorization: 'Bearer execution-token' })
    )
    expect(await response.json()).toMatchObject({
      output: { passed: false, error: 'No relevant context found in knowledge base' },
    })
    expect(executeProviderRequest).not.toHaveBeenCalled()
  })
})
