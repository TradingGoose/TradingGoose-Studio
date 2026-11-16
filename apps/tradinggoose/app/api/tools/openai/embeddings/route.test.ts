/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  owner: vi.fn(),
  access: vi.fn(),
  generate: vi.fn(),
  listed: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.auth }))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: mocks.owner }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: mocks.access }))
vi.mock('@/lib/mastra/registry', () => ({ assertListedEmbeddingModel: mocks.listed }))
vi.mock('@/lib/embeddings/utils', () => ({
  generateEmbeddings: mocks.generate,
  DEFAULT_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
}))

import { POST } from './route'

const result = {
  model: 'openai/text-embedding-3-small',
  embeddings: [[1, 2]],
  tokens: { prompt: 7, total: 7 },
  usage: { status: 'reported', batches: 1 },
  cost: { status: 'unavailable' },
}
const body = { input: '  exact🔥\n', apiKey: 'request-private-key' }
const request = (data: unknown = body, query = '') =>
  new NextRequest(`http://localhost/api/tools/openai/embeddings${query}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ success: true, userId: 'actual-actor', authType: 'session' })
  mocks.owner.mockResolvedValue({
    ok: true,
    userId: 'actual-actor',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
  })
  mocks.access.mockResolvedValue({ hasAccess: true })
  mocks.listed.mockReturnValue({
    id: result.model,
    provider: 'openai',
    maxInputTokens: 8191,
    dimensions: 1536,
  })
  mocks.generate.mockResolvedValue(result)
})

describe('authenticated native OpenAI embedding route', () => {
  it.each([{ success: false }, { success: true, authType: 'internal_jwt' }])(
    'requires actual authenticated actor before validation or contact (%j)',
    async (auth) => {
      mocks.auth.mockResolvedValue(auth)
      const response = await POST(request())
      expect(response.status).toBe(401)
      expect(mocks.listed).not.toHaveBeenCalled()
      expect(mocks.generate).not.toHaveBeenCalled()
    }
  )
  it.each([
    'actorUserId',
    'workspaceId',
    'workflowId',
    'runId',
    'url',
    'headers',
    'maxRetries',
    'encodingFormat',
    'user',
    '_context',
  ])('rejects supplied body identity/control field %s before contact', async (field) => {
    const response = await POST(request({ ...body, [field]: 'forged' }))
    expect(response.status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it.each([
    { input: [], apiKey: body.apiKey },
    { input: ['one', 42], apiKey: body.apiKey },
    { ...body, apiKey: '' },
    { ...body, apiKey: '   ' },
    { apiKey: body.apiKey },
  ])('refuses malformed input/key (%j)', async (invalid) => {
    expect((await POST(request(invalid))).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it.each(['text-embedding-3-small', 'openai/gpt-4.1', 'openai/unlisted'])(
    'rejects non-embedding/unlisted model %s before scope/contact',
    async (model) => {
      mocks.listed.mockImplementationOnce(() => {
        throw Object.assign(new Error('Select a listed embedding model'), { status: 400 })
      })
      expect((await POST(request({ ...body, model }, '?workflowId=workflow-1'))).status).toBe(400)
      expect(mocks.owner).not.toHaveBeenCalled()
      expect(mocks.generate).not.toHaveBeenCalled()
    }
  )
  it('rejects another native embedding provider for this OpenAI tool', async () => {
    mocks.listed.mockReturnValueOnce({ provider: 'google' })
    expect((await POST(request({ ...body, model: 'google/gemini-embedding-001' }))).status).toBe(
      400
    )
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it.each(['?workspaceId=', '?workflowId=%20workflow-1', '?workflowId=one&workflowId=two'])(
    'rejects malformed query scope %s',
    async (query) => {
      expect((await POST(request(body, query))).status).toBe(400)
      expect(mocks.generate).not.toHaveBeenCalled()
    }
  )
  it.each([403, 404])('refuses inaccessible/missing workflow scope (%i)', async (status) => {
    mocks.owner.mockResolvedValueOnce({ ok: false, error: 'Workflow access refused', status })
    expect((await POST(request(body, '?workflowId=workflow-1'))).status).toBe(status)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('refuses workspace tampering and independently checks workspace-only access', async () => {
    expect((await POST(request(body, '?workflowId=workflow-1&workspaceId=wrong'))).status).toBe(403)
    mocks.access.mockResolvedValueOnce({ hasAccess: false })
    expect((await POST(request(body, '?workspaceId=workspace-1'))).status).toBe(403)
    expect(mocks.access).toHaveBeenCalledWith('workspace-1', 'actual-actor')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('preserves input bytes and request-local key with original actor, freshly authorized scope and server-created run', async () => {
    const req = request(
      { ...body, input: [body.input, 'same', 'same'] },
      '?workflowId=workflow-1&workspaceId=workspace-1&actorUserId=forged&runId=forged'
    )
    const response = await POST(req)
    expect(response.status).toBe(200)
    expect(mocks.auth).toHaveBeenCalledWith(req, { requireWorkflowId: false })
    expect(mocks.owner).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actual-actor' }),
      'workflow-1',
      'read'
    )
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
      [body.input, 'same', 'same'],
      {
        actorUserId: 'actual-actor',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        apiKey: body.apiKey,
        signal: req.signal,
        runId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      },
      result.model
    )
    expect(await response.json()).toEqual({
      success: true,
      output: {
        embeddings: result.embeddings,
        model: result.model,
        tokens: result.tokens,
        cost: result.cost,
        embeddingUsage: result.usage,
      },
    })
  })
  it('keeps personal scope null and missing native usage unavailable without fake zero', async () => {
    mocks.generate.mockResolvedValueOnce({
      ...result,
      tokens: {},
      usage: { status: 'unavailable', batches: 1 },
    })
    const response = await POST(request())
    expect(mocks.generate).toHaveBeenCalledWith(
      [body.input],
      expect.objectContaining({ actorUserId: 'actual-actor', workspaceId: null, workflowId: null }),
      result.model
    )
    expect(await response.json()).toMatchObject({
      success: true,
      output: {
        tokens: {},
        cost: { status: 'unavailable' },
        embeddingUsage: { status: 'unavailable', batches: 1 },
      },
    })
  })
  it('preserves completed vectors/facts on later provider or financial failure without forwarding SDK envelopes/key', async () => {
    const error = Object.assign(new Error(`later failure ${body.apiKey}`), {
      model: result.model,
      tokens: result.tokens,
      cost: result.cost,
      embeddingUsage: { status: 'partial', batches: 1 },
      completedEmbeddings: result.embeddings,
      headers: { authorization: body.apiKey },
      response: { raw: 'private-sdk-envelope' },
      binding: { fingerprint: 'private' },
    })
    mocks.generate.mockRejectedValueOnce(error)
    const response = await POST(request())
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toEqual({
      success: false,
      error: 'later failure [redacted]',
      output: {
        embeddings: result.embeddings,
        model: result.model,
        tokens: result.tokens,
        cost: result.cost,
        embeddingUsage: { status: 'partial', batches: 1 },
      },
    })
    expect(JSON.stringify(json)).not.toMatch(
      /request-private-key|private-sdk-envelope|fingerprint|authorization/
    )
  })
  it('returns a safe precontact service error without an invented partial success', async () => {
    mocks.generate.mockRejectedValueOnce(new Error(`configuration unavailable ${body.apiKey}`))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'configuration unavailable [redacted]',
    })
  })
})
