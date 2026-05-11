import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPortfolioDetailMock = vi.fn()
const getTradingProviderOAuthEnvironmentMock = vi.fn()

vi.mock('@/providers/trading', () => ({
  getTradingProvider: (providerId: string) => ({
    id: providerId,
    name: providerId === 'tradier' ? 'Tradier' : 'Alpaca',
  }),
  getTradingProviderOAuthEnvironment: (...args: unknown[]) =>
    getTradingProviderOAuthEnvironmentMock(...args),
}))

vi.mock('@/providers/trading/portfolio', () => ({
  getPortfolioDetail: (...args: unknown[]) => getPortfolioDetailMock(...args),
}))

import { getTradingHoldings } from '@/lib/trading/holdings'
import { tradingHoldingsTool } from '@/tools/trading/holdings'

const portfolioIdentity = {
  providerId: 'tradier',
  credentialId: 'credential-1',
  credentialServiceId: 'tradier-live',
  accountId: 'ACC-2',
}

describe('tradingHoldingsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTradingProviderOAuthEnvironmentMock.mockReturnValue('live')
    getPortfolioDetailMock.mockResolvedValue({ accountId: 'ACC-2' })
  })

  it('fetches holdings for the selected portfolioIdentity account', async () => {
    const result = await getTradingHoldings({
      provider: 'tradier',
      accessToken: 'access-token',
      portfolioIdentity,
    })

    expect(result).toMatchObject({
      provider: 'tradier',
      holdings: { accountId: 'ACC-2' },
    })
    expect(getPortfolioDetailMock).toHaveBeenCalledWith({
      providerId: 'tradier',
      credentialId: 'credential-1',
      credentialServiceId: 'tradier-live',
      environment: 'live',
      accessToken: 'access-token',
      accountId: 'ACC-2',
    })
  })

  it('sends the tool-resolved access token to the holdings route', () => {
    expect(
      tradingHoldingsTool.request.body?.({
        provider: 'tradier',
        credential: 'credential-1',
        accessToken: 'access-token',
        portfolioIdentity,
      })
    ).toMatchObject({
      provider: 'tradier',
      accessToken: 'access-token',
      portfolioIdentity,
    })
  })

  it('resolves OAuth by portfolioIdentity credential id', () => {
    expect(tradingHoldingsTool.params.credential).toMatchObject({
      type: 'string',
      visibility: 'hidden',
    })
  })

  it('requires the tool-resolved access token', async () => {
    await expect(
      getTradingHoldings({
        provider: 'tradier',
        portfolioIdentity,
      })
    ).rejects.toThrow('Trading provider access token is required')

    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })

  it('rejects portfolioIdentity from a different provider', async () => {
    await expect(
      getTradingHoldings({
        provider: 'alpaca',
        accessToken: 'access-token',
        portfolioIdentity,
      })
    ).rejects.toThrow('Portfolio identity does not match provider')

    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })
})
