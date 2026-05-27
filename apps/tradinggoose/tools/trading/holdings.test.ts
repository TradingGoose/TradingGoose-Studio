import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPortfolioDetailMock = vi.fn()
const authorizeTradingConnectionRequestMock = vi.fn()
const resolveTradingProviderContextMock = vi.fn()
const resolveTradingProviderSelectedAccountMock = vi.fn()

vi.mock('@/providers/trading/portfolio', () => ({
  getPortfolioDetail: (...args: unknown[]) => getPortfolioDetailMock(...args),
}))

vi.mock('@/lib/trading/context', () => ({
  authorizeTradingConnectionRequest: (...args: unknown[]) =>
    authorizeTradingConnectionRequestMock(...args),
  resolveTradingProviderContext: (...args: unknown[]) => resolveTradingProviderContextMock(...args),
  resolveTradingProviderSelectedAccount: (...args: unknown[]) =>
    resolveTradingProviderSelectedAccountMock(...args),
}))

import { getTradingHoldings } from '@/lib/trading/holdings'
import { tradingHoldingsTool } from '@/tools/trading/holdings'

const portfolioIdentity = {
  providerId: 'tradier',
  credentialId: 'oauth-credential-1',
  serviceId: 'tradier-live',
  accountId: 'ACC-2',
}

describe('tradingHoldingsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPortfolioDetailMock.mockResolvedValue({ accountId: 'ACC-2' })
    authorizeTradingConnectionRequestMock.mockResolvedValue({
      connectionOwnerUserId: 'user-1',
      tokenAccountId: 'oauth-account-1',
      accountProviderId: 'tradier-live',
    })
    resolveTradingProviderContextMock.mockResolvedValue({
      requestId: 'request-1',
      providerId: 'tradier',
      credentialId: 'oauth-credential-1',
      tokenAccountId: 'oauth-account-1',
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
        workspaceId: 'workspace-1',
        portfolioIdentity,
      },
      requestId: 'request-1',
      userId: 'user-1',
    })

    expect(result).toMatchObject({
      provider: 'tradier',
      holdings: { accountId: 'ACC-2' },
    })
    expect(resolveTradingProviderContextMock).toHaveBeenCalledWith({
      requestData: {
        provider: 'tradier',
        credentialId: 'oauth-credential-1',
        serviceId: 'tradier-live',
        workspaceId: 'workspace-1',
      },
      requestId: 'request-1',
      userId: 'user-1',
      connectionOwnerUserId: 'user-1',
      tokenAccountId: 'oauth-account-1',
      accountProviderId: 'tradier-live',
    })
    expect(getPortfolioDetailMock).toHaveBeenCalledWith({
      providerId: 'tradier',
      credentialId: 'oauth-credential-1',
      tokenAccountId: 'oauth-account-1',
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

  it('declares workspace read scope for tool execution', () => {
    expect(tradingHoldingsTool.execution).toEqual({
      workspace: { required: true, access: 'read' },
    })
  })

  it('authorizes the selected portfolio connection before broker calls', async () => {
    authorizeTradingConnectionRequestMock.mockRejectedValue(new Error('Unauthorized'))

    await expect(
      getTradingHoldings({
        requestData: {
          workspaceId: 'workspace-1',
          portfolioIdentity,
        },
        requestId: 'request-1',
        userId: 'user-1',
      })
    ).rejects.toThrow('Unauthorized')

    expect(authorizeTradingConnectionRequestMock).toHaveBeenCalledWith({
      credentialId: 'oauth-credential-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(resolveTradingProviderContextMock).not.toHaveBeenCalled()
    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })
})
