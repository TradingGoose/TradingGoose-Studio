import type { NextRequest } from 'next/server'
import {
  authorizeTradingCredentialRequest,
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
  workspaceId?: string
  workflowId?: string
}

export type TradingHoldingsResult = {
  summary: string
  provider: string
  holdings: PortfolioDetail
}

export async function getTradingHoldings({
  request,
  requestData,
  requestId,
  userId,
}: {
  request: NextRequest
  requestData: TradingHoldingsRequest
  requestId: string
  userId: string
}): Promise<TradingHoldingsResult> {
  const portfolioIdentity = toPortfolioValueObject(requestData.portfolioIdentity)

  if (!portfolioIdentity) {
    throw new TradingServiceError('Portfolio identity is required')
  }
  const credentialAuthorization = await authorizeTradingCredentialRequest({
    request,
    credentialId: portfolioIdentity.credentialId,
    workspaceId: requestData.workspaceId,
    workflowId: requestData.workflowId,
  })

  const baseContext = await resolveTradingProviderContext({
    requestData: {
      provider: portfolioIdentity.providerId,
      credentialId: portfolioIdentity.credentialId,
      serviceId: portfolioIdentity.serviceId,
    },
    requestId,
    userId,
    credentialOwnerUserId: credentialAuthorization.credentialOwnerUserId,
    tokenAccountId: credentialAuthorization.tokenAccountId,
    accountProviderId: credentialAuthorization.accountProviderId,
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
    credentialId: baseContext.credentialId,
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
