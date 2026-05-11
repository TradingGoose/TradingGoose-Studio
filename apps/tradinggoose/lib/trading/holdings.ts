import { getTradingProvider, getTradingProviderOAuthEnvironment } from '@/providers/trading'
import { getPortfolioDetail } from '@/providers/trading/portfolio'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import type { TradingProviderId } from '@/providers/trading/types'
import { TradingServiceError } from './errors'

export interface TradingHoldingsRequest {
  provider: TradingProviderId
  portfolioIdentity?: PortfolioIdentity | null
  credential?: string
  accessToken?: string
}

export type TradingHoldingsResult = {
  summary: string
  provider: string
  holdings: PortfolioDetail
}

export async function getTradingHoldings({
  accessToken,
  ...params
}: Omit<TradingHoldingsRequest, 'accessToken'> & {
  accessToken?: string | null
}): Promise<TradingHoldingsResult> {
  const provider = getTradingProvider(params.provider)
  const portfolioIdentity = toPortfolioValueObject(params.portfolioIdentity)

  if (!portfolioIdentity) {
    throw new TradingServiceError('Portfolio identity is required')
  }

  if (portfolioIdentity.providerId !== provider.id) {
    throw new TradingServiceError('Portfolio identity does not match provider')
  }

  if (!accessToken) {
    throw new TradingServiceError('Trading provider access token is required')
  }

  const environment = getTradingProviderOAuthEnvironment(
    provider.id,
    portfolioIdentity.credentialServiceId
  )
  if (!environment) {
    throw new TradingServiceError('Trading provider connection is not configured')
  }

  const holdings = await getPortfolioDetail({
    providerId: provider.id,
    credentialId: portfolioIdentity.credentialId,
    credentialServiceId: portfolioIdentity.credentialServiceId,
    environment,
    accessToken,
    accountId: portfolioIdentity.accountId,
  })

  return {
    summary: `Fetched portfolio detail from ${provider.name}`,
    provider: provider.id,
    holdings,
  }
}
