import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPortfolioDetailMock = vi.fn()
const checkWorkspaceAccessMock = vi.fn()
const resolveTradingProviderContextMock = vi.fn()
const resolveTradingProviderSelectedAccountMock = vi.fn()

vi.mock('@/providers/trading', () => ({
  getTradingProvider: (providerId: string) => ({
    id: providerId,
    name: providerId === 'tradier' ? 'Tradier' : 'Alpaca',
  }),
}))

vi.mock('@/providers/trading/portfolio', () => ({
  getPortfolioDetail: (...args: unknown[]) => getPortfolioDetailMock(...args),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => checkWorkspaceAccessMock(...args),
}))

vi.mock('@/lib/trading/context', () => ({
  resolveTradingProviderContext: (...args: unknown[]) => resolveTradingProviderContextMock(...args),
  resolveTradingProviderSelectedAccount: (...args: unknown[]) =>
    resolveTradingProviderSelectedAccountMock(...args),
}))

import { getTradingHoldings } from '@/lib/trading/holdings'
import { tradingHoldingsTool } from '@/tools/trading/holdings'

const portfolioIdentity = {
  providerId: 'tradier',
  credentialId: 'credential-1',
  serviceId: 'tradier-live',
  accountId: 'ACC-2',
}

describe('tradingHoldingsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPortfolioDetailMock.mockResolvedValue({ accountId: 'ACC-2' })
    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: true })
    resolveTradingProviderContextMock.mockResolvedValue({
      requestId: 'request-1',
      providerId: 'tradier',
      credentialId: 'credential-1',
      serviceId: 'tradier-live',
      environment: 'live',
      accessToken: 'access-token',
      sessionUserId: 'user-1',
    })
    resolveTradingProviderSelectedAccountMock.mockResolvedValue({
      accountId: 'ACC-2',
      portfolioIdentity,
    })
  })

  it('fetches holdings for the selected portfolioIdentity account', async () => {
    const result = await getTradingHoldings({
      requestData: {
        portfolioIdentity,
      },
      requestId: 'request-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result).toMatchObject({
      provider: 'tradier',
      holdings: { accountId: 'ACC-2' },
    })
    expect(getPortfolioDetailMock).toHaveBeenCalledWith({
      providerId: 'tradier',
      credentialId: 'credential-1',
      serviceId: 'tradier-live',
      environment: 'live',
      accessToken: 'access-token',
      accountId: 'ACC-2',
    })
  })

  it('sends only canonical holdings request data to the holdings route', () => {
    expect(
      tradingHoldingsTool.request.body?.({
        portfolioIdentity,
      })
    ).toMatchObject({
      portfolioIdentity,
    })
  })

  it('requires workspace execution context', () => {
    expect(tradingHoldingsTool.execution).toEqual({
      workspace: { required: true, access: 'read' },
    })
  })

  it('rejects missing workspace access before broker calls', async () => {
    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: false })

    await expect(
      getTradingHoldings({
        requestData: {
          portfolioIdentity,
        },
        requestId: 'request-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).rejects.toThrow('Not found')

    expect(resolveTradingProviderContextMock).not.toHaveBeenCalled()
    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })
})
