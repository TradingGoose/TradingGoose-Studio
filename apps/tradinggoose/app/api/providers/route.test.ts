/** @vitest-environment node */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  execute: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.authenticate }))
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
    const request = new NextRequest('http://localhost/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        provider: `market:${provider}/series`,
        listing,
        userId: 'forged-user',
        authUserId: 'forged-user',
        requestId: 'forged-request',
        _context: { userId: 'forged-user' },
        auth: { apiKey: 'key', apiSecret: 'secret', accessToken: 'forged-token' },
        providerParams: { credentialId: 'connection' },
      }),
    })
    expect((await POST(request)).status).toBe(status)
    expect(mocks.authenticate).toHaveBeenCalledTimes(provider === 'robinhood' ? 1 : 0)
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
})
