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

import { getTradingPortfolioDetail } from '@/lib/trading/portfolio-detail'
import { tradingPortfolioDetailTool } from '@/tools/trading/portfolio-detail'

const portfolioIdentity = {
  providerId: 'tradier',
  credentialId: 'oauth-credential-1',
  serviceId: 'tradier-live',
  accountId: 'ACC-2',
}

describe('tradingPortfolioDetailTool', () => {
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

  it('fetches portfolio detail for the selected portfolioIdentity account', async () => {
    const result = await getTradingPortfolioDetail({
      requestData: {
        workspaceId: 'workspace-1',
        portfolioIdentity,
      },
      requestId: 'request-1',
      userId: 'user-1',
    })

    expect(result).toMatchObject({
      provider: 'tradier',
      portfolioDetail: { accountId: 'ACC-2' },
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

  it('sends only canonical portfolio detail request data to the portfolio detail route', () => {
    expect(
      tradingPortfolioDetailTool.request.body?.({
        portfolioIdentity,
      })
    ).toMatchObject({
      portfolioIdentity,
    })
  })

  it('declares workspace read scope for tool execution', () => {
    expect(tradingPortfolioDetailTool.execution).toEqual({
      workspace: { required: true, access: 'read' },
    })
  })

  it('authorizes the selected portfolio connection before broker calls', async () => {
    authorizeTradingConnectionRequestMock.mockRejectedValue(new Error('Unauthorized'))

    await expect(
      getTradingPortfolioDetail({
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
