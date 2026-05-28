import {
  authorizeTradingConnectionRequest,
  resolveTradingProviderContext,
  resolveTradingProviderSelectedAccount,
} from '@/lib/trading/context'
import { getPortfolioDetail } from '@/providers/trading/portfolio'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import { TradingServiceError } from './errors'

export interface TradingPortfolioDetailRequest {
  workspaceId?: string
  portfolioIdentity?: PortfolioIdentity | null
}

export type TradingPortfolioDetailResult = {
  summary: string
  provider: string
  portfolioDetail: PortfolioDetail
}

export async function getTradingPortfolioDetail({
  requestData,
  requestId,
  userId,
}: {
  requestData: TradingPortfolioDetailRequest
  requestId: string
  userId: string
}): Promise<TradingPortfolioDetailResult> {
  const portfolioIdentity = toPortfolioValueObject(requestData.portfolioIdentity)

  if (!portfolioIdentity) {
    throw new TradingServiceError('Portfolio identity is required')
  }
  const workspaceId = requestData.workspaceId?.trim()
  if (!workspaceId) {
    throw new TradingServiceError('workspaceId is required')
  }
  const connectionAuthorization = await authorizeTradingConnectionRequest({
    credentialId: portfolioIdentity.credentialId,
    userId,
    workspaceId,
  })

  const baseContext = await resolveTradingProviderContext({
    requestData: {
      provider: portfolioIdentity.providerId,
      credentialId: portfolioIdentity.credentialId,
      serviceId: portfolioIdentity.serviceId,
      workspaceId,
    },
    requestId,
    userId,
    connectionOwnerUserId: connectionAuthorization.connectionOwnerUserId,
    tokenAccountId: connectionAuthorization.tokenAccountId,
    accountProviderId: connectionAuthorization.accountProviderId,
  })
  const providerDefinition = getTradingProviderDefinition(baseContext.providerId)
  if (!providerDefinition) {
    throw new TradingServiceError('Trading provider is not configured')
  }
  const accountContext = await resolveTradingProviderSelectedAccount({
    baseContext,
    accountId: portfolioIdentity.accountId,
  })

  const portfolioDetail = await getPortfolioDetail({
    providerId: baseContext.providerId,
    credentialId: baseContext.credentialId,
    tokenAccountId: baseContext.tokenAccountId,
    serviceId: baseContext.serviceId,
    environment: baseContext.environment,
    accessToken: baseContext.accessToken,
    accountId: accountContext.accountId,
  })

  return {
    summary: `Fetched portfolio detail from ${providerDefinition.name}`,
    provider: baseContext.providerId,
    portfolioDetail,
  }
}
