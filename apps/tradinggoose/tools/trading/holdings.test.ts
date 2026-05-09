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

import { executeTradingHoldings } from '@/tools/trading/holdings'

const portfolioIdentity = {
  providerId: 'tradier',
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
    const result = await executeTradingHoldings({
      provider: 'tradier',
      accessToken: 'access-token',
      portfolioIdentity,
    })

    expect(result?.success).toBe(true)
    expect(getPortfolioDetailMock).toHaveBeenCalledWith({
      providerId: 'tradier',
      credentialServiceId: 'tradier-live',
      environment: 'live',
      accessToken: 'access-token',
      accountId: 'ACC-2',
    })
  })

  it('requires the route-resolved access token', async () => {
    const result = await executeTradingHoldings({
      provider: 'tradier',
      portfolioIdentity,
    })

    expect(result).toMatchObject({
      success: false,
      error: 'Trading provider access token is required',
    })
    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })

  it('rejects portfolioIdentity from a different provider', async () => {
    const result = await executeTradingHoldings({
      provider: 'alpaca',
      accessToken: 'access-token',
      portfolioIdentity,
    })

    expect(result).toMatchObject({
      success: false,
      error: 'Portfolio identity does not match provider',
    })
    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })
})
