/** @vitest-environment node */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { handleAIProviderRequest } from '@/app/api/providers/ai/handler'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  authorizeCredential: vi.fn(),
  credentialAuthStatus: vi.fn(),
  execute: vi.fn(),
  authorizeWorkflow: vi.fn(),
  workspaceAccess: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: vi.fn() }))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: mocks.authorizeWorkflow }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: mocks.workspaceAccess }))
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mocks.authorizeCredential,
  credentialAuthStatus: mocks.credentialAuthStatus,
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/environment/utils', () => ({ getEffectiveDecryptedEnv: vi.fn() }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/utils', () => ({ generateRequestId: () => 'server-request' }))
vi.mock('@/providers/market', () => ({ executeProviderRequest: mocks.execute }))
vi.mock('@/providers/market/providers', () => ({
  getMarketProviderDefinition: (id: string) =>
    id === 'robinhood' ? { oauth: { provider: 'robinhood' } } : {},
}))
vi.mock('@/app/api/providers/ai/handler', () => ({ handleAIProviderRequest: vi.fn() }))

const listing = { listing_type: 'default', listing_id: 'AAPL', base_id: '', quote_id: '' }
const forgedIdentity = {
  userId: 'forged-user',
  authUserId: 'forged-user',
  credentialOwnerUserId: 'forged-user',
  requestId: 'forged-request',
  _context: { userId: 'forged-user' },
  auth: { apiKey: 'key', apiSecret: 'secret', accessToken: 'forged-token' },
}
const marketRequest = (provider: string, credentialId: unknown, query = '', workspaceId?: string) =>
  new NextRequest(`http://localhost/api/providers${query}`, {
    method: 'POST',
    body: JSON.stringify({
      providerNamespace: 'market',
      provider: `${provider}/series`,
      listing,
      workspaceId,
      ...forgedIdentity,
      providerParams: { credentialId },
    }),
  })

// Exercise the real route and handler with the same forged fields in every case.
describe('market provider credential boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.execute.mockResolvedValue({ bars: [] })
  })

  it('passes non-OAuth market providers through without credential authorization', async () => {
    const request = marketRequest('alpaca', 'connection')
    expect((await POST(request)).status).toBe(200)
    expect(mocks.authorizeCredential).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledWith(
      'alpaca/series',
      {
        kind: 'series',
        listing,
        auth: { apiKey: 'key', apiSecret: 'secret' },
        providerParams: { credentialId: 'connection' },
      },
      { userId: undefined, requestId: 'server-request' }
    )
  })

  it.each([
    ['allowed workflow collaborator', {}, 200, undefined],
    ['allowed shared widget collaborator', {}, 200, 'workspace-1'],
    ['revoked access', { ok: false, error: 'Unauthorized' }, 403],
    ['unknown credential', { ok: false, error: 'Credential not found' }, 404],
    ['wrong provider', { resolvedProviderId: 'alpaca' }, 403],
    ['missing owner', { credentialOwnerUserId: undefined }, 401],
    ['missing account', { resolvedTokenAccountId: undefined }, 401],
  ])('resolves market credentials: %s', async (_label, result, status, workspaceId = undefined) => {
    mocks.authorizeCredential.mockResolvedValue({
      ok: true,
      requesterUserId: 'execution-user',
      credentialOwnerUserId: 'collaborator',
      resolvedTokenAccountId: 'personal-account',
      resolvedProviderId: 'robinhood',
      ...result,
    })
    mocks.credentialAuthStatus.mockReturnValue(status)
    const request = marketRequest(
      'robinhood',
      'workspace-credential',
      workspaceId ? '' : '?workflowId=workflow-1&workspaceId=workspace-1',
      workspaceId
    )
    expect((await POST(request)).status).toBe(status)
    expect(mocks.authorizeCredential).toHaveBeenCalledWith(request, {
      credentialId: 'workspace-credential',
      workflowId: workspaceId ? undefined : 'workflow-1',
      workspaceId: 'workspace-1',
    })
    if (status === 200) {
      expect(mocks.execute).toHaveBeenCalledWith(
        'robinhood/series',
        expect.objectContaining({ providerParams: { credentialId: 'personal-account' } }),
        { userId: 'collaborator', requestId: 'server-request' }
      )
    } else {
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  })

  it.each([undefined, '', ' ', 123])(
    'rejects an invalid OAuth market credential: %s',
    async (credentialId) => {
      const response = await POST(
        marketRequest('robinhood', credentialId, '?workflowId=workflow-1')
      )
      expect(response.status).toBe(400)
      expect(mocks.authorizeCredential).not.toHaveBeenCalled()
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )
})

describe('native AI tool authorization boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })
  it('rejects tool-bearing requests without a session or internal actor', async () => {
    vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: false } as any)
    const response = await POST(
      new NextRequest('http://localhost/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          providerNamespace: 'ai',
          model: 'openai/gpt-4.1',
          tools: [{ id: 'lookup' }],
        }),
      })
    )
    expect(response.status).toBe(401)
    expect(handleAIProviderRequest).not.toHaveBeenCalled()
  })
  it('binds tool calls to the authenticated actor instead of supplied identity fields', async () => {
    vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
      success: true,
      userId: 'authenticated-actor',
    } as any)
    vi.mocked(handleAIProviderRequest).mockResolvedValue(Response.json({ content: 'OK' }) as any)
    const response = await POST(
      new NextRequest('http://localhost/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          providerNamespace: 'ai',
          model: 'openai/gpt-4.1',
          userId: 'forged',
          tools: [{ id: 'lookup' }],
        }),
      })
    )
    expect(response.status).toBe(200)
    expect(handleAIProviderRequest).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId: 'authenticated-actor' })
    )
  })
})

describe('native AI generation boundary', () => {
  beforeEach(() => vi.resetAllMocks())
  const request = (extra = {}) =>
    new NextRequest('http://localhost/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        providerNamespace: 'ai',
        model: 'openai/gpt-4.1',
        messages: [],
        ...extra,
      }),
    })
  it.each([{}, { apiKey: 'caller-key' }])(
    'authenticates generation without tools (%j)',
    async (extra) => {
      vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({ success: false } as any)
      expect((await POST(request(extra))).status).toBe(401)
      expect(checkSessionOrInternalAuth).toHaveBeenCalledOnce()
      expect(handleAIProviderRequest).not.toHaveBeenCalled()
    }
  )
  it('catches asynchronous preflight rejections as actionable JSON', async () => {
    vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
      success: true,
      userId: 'actor',
    } as any)
    vi.mocked(handleAIProviderRequest).mockRejectedValue(
      Object.assign(new Error('Select a listed provider/model in the Model field.'), {
        status: 400,
      })
    )
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Select a listed provider/model in the Model field.',
    })
  })
  it('preserves completed native accounting and redacts keys in failure messages', async () => {
    vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
      success: true,
      userId: 'actor',
    } as any)
    vi.mocked(handleAIProviderRequest).mockRejectedValue(
      Object.assign(new Error('Connection rejected caller-key; Authorization: Bearer secret'), {
        tokens: { total: 30 },
        cost: { status: 'partial', availableTotal: 0.004, estimated: true },
        request: { apiKey: 'caller-key' },
      })
    )
    const response = await POST(request({ apiKey: 'caller-key' }))
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data).toMatchObject({
      tokens: { total: 30 },
      cost: { status: 'partial', availableTotal: 0.004, estimated: true },
    })
    expect(JSON.stringify(data)).not.toContain('caller-key')
    expect(JSON.stringify(data)).not.toContain('Bearer secret')
    expect(data).not.toHaveProperty('request')
  })
})

describe('AI execution scope normalization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(checkSessionOrInternalAuth).mockResolvedValue({
      success: true,
      userId: 'actual-actor',
    } as any)
    vi.mocked(handleAIProviderRequest).mockResolvedValue(Response.json({ content: 'known' }) as any)
    mocks.authorizeWorkflow.mockResolvedValue({
      ok: true,
      userId: 'actual-actor',
      workflowId: 'workflow',
      workspaceId: 'workspace',
    })
    mocks.workspaceAccess.mockResolvedValue({ hasAccess: true })
  })
  it.each([
    [{}, '', undefined, undefined],
    [{ workflowId: 'workflow' }, '', 'workflow', 'workspace'],
    [{ workflowId: ' workflow ', workspaceId: ' workspace ' }, '', 'workflow', 'workspace'],
    [{}, '?workflowId=%20workflow%20&workspaceId=workspace', 'workflow', 'workspace'],
    [
      { workflowId: 'workflow' },
      '?workflowId=workflow&workspaceId=workspace',
      'workflow',
      'workspace',
    ],
    [{ workspaceId: ' workspace ' }, '?workspaceId=workspace', undefined, 'workspace'],
  ])('passes a copied normalized scope %j/%s', async (scope, query, workflowId, workspaceId) => {
    const request = new NextRequest(`http://localhost/api/providers${query}`, {
      method: 'POST',
      body: JSON.stringify({
        providerNamespace: 'ai',
        model: 'openai/gpt-4.1',
        apiKey: 'request-key',
        ...scope,
      }),
    })
    expect((await POST(request)).status).toBe(200)
    expect(handleAIProviderRequest).toHaveBeenCalledExactlyOnceWith({
      body: expect.objectContaining({ workflowId, workspaceId, apiKey: 'request-key' }),
      authUserId: 'actual-actor',
      signal: request.signal,
      requestId: 'server-request',
    })
  })
  it.each([
    [{ workflowId: 'other' }, '?workflowId=workflow'],
    [{ workspaceId: 'other' }, '?workspaceId=workspace'],
    [{ workflowId: null }, '?workflowId=workflow'],
    [{ workspaceId: [] }, '?workspaceId=workspace'],
    [{ workflowId: 7 }, ''],
    [{ workspaceId: {} }, ''],
    [{ workspaceId: ' ' }, '?workspaceId=workspace'],
    [{ workflowId: 'workflow' }, '?workflowId='],
    [{}, '?workspaceId=%20'],
    [{}, '?workflowId=workflow&workflowId=workflow'],
    [{ workspaceId: 'workspace' }, '?workspaceId=workspace&workspaceId=other'],
  ])('refuses malformed/conflicting scope %j/%s before handler', async (scope, query) => {
    const response = await POST(
      new NextRequest(`http://localhost/api/providers${query}`, {
        method: 'POST',
        body: JSON.stringify({ providerNamespace: 'ai', model: 'openai/gpt-4.1', ...scope }),
      })
    )
    expect(response.status).toBe(400)
    expect(handleAIProviderRequest).not.toHaveBeenCalled()
    expect(mocks.authorizeWorkflow).not.toHaveBeenCalled()
    expect(mocks.workspaceAccess).not.toHaveBeenCalled()
  })

  it.each([
    [{ workspaceId: 'workspace' }, { ok: true, workspaceId: 'workspace' }, false, 403],
    [
      { workflowId: 'workflow' },
      { ok: false, error: 'Workflow access denied', status: 403 },
      true,
      403,
    ],
    [
      { workflowId: 'workflow' },
      { ok: false, error: 'Workflow not found', status: 404 },
      true,
      404,
    ],
    [
      { workflowId: 'workflow', workspaceId: 'other' },
      { ok: true, workspaceId: 'workspace' },
      true,
      403,
    ],
  ])(
    'rejects unauthorized billing scope %j before the handler',
    async (scope, owner, access, status) => {
      mocks.authorizeWorkflow.mockResolvedValue(owner)
      mocks.workspaceAccess.mockResolvedValue({ hasAccess: access })
      const response = await POST(
        new NextRequest('http://localhost/api/providers', {
          method: 'POST',
          body: JSON.stringify({ providerNamespace: 'ai', model: 'openai/gpt-4.1', ...scope }),
        })
      )
      expect(response.status).toBe(status)
      expect(handleAIProviderRequest).not.toHaveBeenCalled()
    }
  )
})

it.each([
  { provider: 'openai', model: 'openai/gpt-4.1' },
  { providerType: 'ai', model: 'openai/gpt-4.1' },
  { provider: 'ai:openai', model: 'openai/gpt-4.1' },
  { provider: 'market:alpaca/series' },
])('requires the canonical namespace rather than legacy inference (%j)', async (body) => {
  const response = await POST(
    new NextRequest('http://localhost/api/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  )
  expect(response.status).toBe(400)
  expect(mocks.execute).not.toHaveBeenCalled()
})
