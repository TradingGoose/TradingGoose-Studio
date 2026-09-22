/** @vitest-environment node */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authorizeCredential: vi.fn(),
  credentialAuthStatus: vi.fn(),
  execute: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.authenticate }))
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mocks.authorizeCredential,
  credentialAuthStatus: mocks.credentialAuthStatus,
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
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
const marketRequest = (provider: string, credentialId: unknown, query = '') =>
  new NextRequest(`http://localhost/api/providers${query}`, {
    method: 'POST',
    body: JSON.stringify({
      provider: `market:${provider}/series`,
      listing,
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

  it.each([
    { provider: 'robinhood', success: false, userId: undefined, status: 401 },
    { provider: 'robinhood', success: true, userId: undefined, status: 401 },
    { provider: 'robinhood', success: true, userId: 'owner', status: 200 },
    { provider: 'alpaca', success: false, userId: undefined, status: 200 },
  ])('$provider with session $success/$userId returns $status', async (testCase) => {
    const { provider, status, userId } = testCase
    mocks.authenticate.mockResolvedValue(testCase)
    const request = marketRequest(provider, 'connection')
    expect((await POST(request)).status).toBe(status)
    expect(mocks.authenticate).toHaveBeenCalledTimes(provider === 'robinhood' ? 1 : 0)
    expect(mocks.authorizeCredential).not.toHaveBeenCalled()
    if (status === 401) {
      expect(mocks.execute).not.toHaveBeenCalled()
      return
    }
    expect(mocks.execute).toHaveBeenCalledWith(
      `${provider}/series`,
      {
        kind: 'series',
        listing,
        auth: { apiKey: 'key', apiSecret: 'secret' },
        providerParams: { credentialId: 'connection' },
      },
      { userId, requestId: 'server-request' }
    )
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it.each([
    ['allowed collaborator', {}, 200],
    ['revoked access', { ok: false, error: 'Unauthorized' }, 403],
    ['unknown credential', { ok: false, error: 'Credential not found' }, 404],
    ['wrong provider', { resolvedProviderId: 'alpaca' }, 403],
    ['missing owner', { credentialOwnerUserId: undefined }, 401],
    ['missing account', { resolvedTokenAccountId: undefined }, 401],
  ])('resolves workflow credentials: %s', async (_label, result, status) => {
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
      '?workflowId=workflow-1&workspaceId=workspace-1'
    )
    expect((await POST(request)).status).toBe(status)
    expect(mocks.authorizeCredential).toHaveBeenCalledWith(request, {
      credentialId: 'workspace-credential',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.authenticate).not.toHaveBeenCalled()
    if (status === 200) {
      expect(mocks.execute).toHaveBeenCalledWith(
        'robinhood/series',
        {
          kind: 'series',
          listing,
          auth: { apiKey: 'key', apiSecret: 'secret' },
          providerParams: { credentialId: 'personal-account' },
        },
        { userId: 'collaborator', requestId: 'server-request' }
      )
    } else {
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  })

  it.each([undefined, '', ' ', 123])(
    'rejects an invalid workflow credential: %s',
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
