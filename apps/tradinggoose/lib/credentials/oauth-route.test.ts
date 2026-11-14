import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mocks.authorize,
  credentialAuthStatus: () => 403,
}))
vi.mock('@/lib/oauth/tokens', () => ({ refreshAccessTokenIfNeeded: mocks.refresh }))

import { resolveOAuthRouteCredential } from './oauth-route'

const verified = {
  ok: true,
  requesterUserId: 'actual-requester',
  workspaceId: 'authorized-workspace',
  credentialOwnerUserId: 'credential-owner',
  resolvedTokenAccountId: 'token-account',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({ ...verified })
  mocks.refresh.mockResolvedValue('token')
})
describe('verified OAuth download authority', () => {
  it('returns verified requester and workspace independently of token owner and supplied scope', async () => {
    const request = new NextRequest('http://localhost/api/tool?workflowId=original-workflow')
    const result = await resolveOAuthRouteCredential(
      request,
      { credentialId: 'credential', workspaceId: 'requested-workspace' },
      'request'
    )
    expect(mocks.authorize).toHaveBeenCalledWith(request, {
      credentialId: 'credential',
      workflowId: 'original-workflow',
      workspaceId: 'requested-workspace',
    })
    expect(result).toEqual({
      ok: true,
      accessToken: 'token',
      credentialId: 'credential',
      requesterUserId: 'actual-requester',
      workspaceId: 'authorized-workspace',
    })
    expect(mocks.refresh).toHaveBeenCalledWith('token-account', 'credential-owner', 'request')
  })
  it.each([
    { requesterUserId: undefined },
    { requesterUserId: ' ' },
    { workspaceId: undefined },
    { workspaceId: ' ' },
    { ok: false },
  ])('refuses absent/denied genuine authority before token contact: %j', async (change) => {
    mocks.authorize.mockResolvedValue({ ...verified, ...change })
    const result = await resolveOAuthRouteCredential(
      new NextRequest('http://localhost/api/tool'),
      { credentialId: 'credential' },
      'request'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
