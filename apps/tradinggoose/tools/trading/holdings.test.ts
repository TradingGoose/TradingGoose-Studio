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

import { tradingHoldingsTool } from '@/tools/trading/holdings'

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
    const result = await tradingHoldingsTool.directExecution?.({
      provider: 'tradier',
      credentialServiceId: 'tradier-live',
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

  it('rejects portfolioIdentity from a different credential service', async () => {
    const result = await tradingHoldingsTool.directExecution?.({
      provider: 'tradier',
      credentialServiceId: 'tradier-paper',
      accessToken: 'access-token',
      portfolioIdentity,
    })

    expect(result).toMatchObject({
      success: false,
      error: 'Portfolio identity does not match provider connection',
    })
    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })
})
