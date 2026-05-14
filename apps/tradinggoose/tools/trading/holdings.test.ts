import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPortfolioDetailMock = vi.fn()
const authorizeTradingCredentialRequestMock = vi.fn()
const resolveTradingProviderContextMock = vi.fn()
const resolveTradingProviderSelectedAccountMock = vi.fn()

vi.mock('@/providers/trading/portfolio', () => ({
  getPortfolioDetail: (...args: unknown[]) => getPortfolioDetailMock(...args),
}))

vi.mock('@/lib/trading/context', () => ({
  authorizeTradingCredentialRequest: (...args: unknown[]) =>
    authorizeTradingCredentialRequestMock(...args),
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
    authorizeTradingCredentialRequestMock.mockResolvedValue({
      credentialOwnerUserId: 'user-1',
      tokenAccountId: 'account-credential-1',
      accountProviderId: 'tradier-live',
    })
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
    const request = new NextRequest('http://localhost/api/tools/trading/holdings')
    const result = await getTradingHoldings({
      request,
      requestData: {
        portfolioIdentity,
        workspaceId: 'workspace-1',
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
        credentialId: 'credential-1',
        serviceId: 'tradier-live',
      },
      requestId: 'request-1',
      userId: 'user-1',
      credentialOwnerUserId: 'user-1',
      tokenAccountId: 'account-credential-1',
      accountProviderId: 'tradier-live',
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

  it('requires workspace scope for credential-owned portfolio reads', () => {
    expect(tradingHoldingsTool.execution).toEqual({
      workspace: { required: true, access: 'read' },
    })
  })

  it('authorizes the selected portfolio credential before broker calls', async () => {
    const request = new NextRequest('http://localhost/api/tools/trading/holdings')
    authorizeTradingCredentialRequestMock.mockRejectedValue(new Error('Unauthorized'))

    await expect(
      getTradingHoldings({
        request,
        requestData: {
          portfolioIdentity,
          workspaceId: 'workspace-1',
        },
        requestId: 'request-1',
        userId: 'user-1',
      })
    ).rejects.toThrow('Unauthorized')

    expect(authorizeTradingCredentialRequestMock).toHaveBeenCalledWith({
      request,
      credentialId: 'credential-1',
      workspaceId: 'workspace-1',
      workflowId: undefined,
    })
    expect(resolveTradingProviderContextMock).not.toHaveBeenCalled()
    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })
})
