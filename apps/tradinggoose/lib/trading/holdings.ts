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

export interface TradingHoldingsRequest {
  portfolioIdentity?: PortfolioIdentity | null
}

export type TradingHoldingsResult = {
  summary: string
  provider: string
  holdings: PortfolioDetail
}

export async function getTradingHoldings({
  requestData,
  requestId,
  userId,
}: {
  requestData: TradingHoldingsRequest
  requestId: string
  userId: string
}): Promise<TradingHoldingsResult> {
  const portfolioIdentity = toPortfolioValueObject(requestData.portfolioIdentity)

  if (!portfolioIdentity) {
    throw new TradingServiceError('Portfolio identity is required')
  }
  const connectionAuthorization = await authorizeTradingConnectionRequest({
    tokenAccountId: portfolioIdentity.tokenAccountId,
    userId,
  })

  const baseContext = await resolveTradingProviderContext({
    requestData: {
      provider: portfolioIdentity.providerId,
      tokenAccountId: portfolioIdentity.tokenAccountId,
      serviceId: portfolioIdentity.serviceId,
    },
    requestId,
    userId,
    connectionOwnerUserId: connectionAuthorization.connectionOwnerUserId,
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

  const holdings = await getPortfolioDetail({
    providerId: baseContext.providerId,
    tokenAccountId: baseContext.tokenAccountId,
    serviceId: baseContext.serviceId,
    environment: baseContext.environment,
    accessToken: baseContext.accessToken,
    accountId: accountContext.accountId,
  })

  return {
    summary: `Fetched portfolio detail from ${providerDefinition.name}`,
    provider: baseContext.providerId,
    holdings,
  }
}
