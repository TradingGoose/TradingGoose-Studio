/** @vitest-environment node */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  authorizeCredential: vi.fn(),
  credentialAuthStatus: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: vi.fn() }))
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
      provider: `market:${provider}/series`,
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
