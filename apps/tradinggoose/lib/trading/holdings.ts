import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import {
  resolveTradingProviderContext,
  resolveTradingProviderSelectedAccount,
} from '@/lib/trading/context'
import { getTradingProvider } from '@/providers/trading'
import { getPortfolioDetail } from '@/providers/trading/portfolio'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
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
  workspaceId,
}: {
  requestData: TradingHoldingsRequest
  requestId: string
  userId: string
  workspaceId: string
}): Promise<TradingHoldingsResult> {
  const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
  if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
    throw new TradingServiceError('Not found', 404)
  }

  const portfolioIdentity = toPortfolioValueObject(requestData.portfolioIdentity)

  if (!portfolioIdentity) {
    throw new TradingServiceError('Portfolio identity is required')
  }

  const baseContext = await resolveTradingProviderContext({
    requestData: {
      provider: portfolioIdentity.providerId,
      credentialId: portfolioIdentity.credentialId,
      serviceId: portfolioIdentity.serviceId,
    },
    requestId,
    userId,
  })
  const provider = getTradingProvider(baseContext.providerId)
  const accountContext = await resolveTradingProviderSelectedAccount({
    baseContext,
    accountId: portfolioIdentity.accountId,
  })

  const holdings = await getPortfolioDetail({
    providerId: baseContext.providerId,
    credentialId: baseContext.credentialId,
    serviceId: baseContext.serviceId,
    environment: baseContext.environment,
    accessToken: baseContext.accessToken,
    accountId: accountContext.accountId,
  })

  return {
    summary: `Fetched portfolio detail from ${provider.name}`,
    provider: provider.id,
    holdings,
  }
}
