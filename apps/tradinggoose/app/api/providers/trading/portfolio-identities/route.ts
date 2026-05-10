import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { listPortfolioIdentities } from '@/providers/trading/portfolio'
import {
  getPortfolioIdentityKey,
  type PortfolioIdentity,
} from '@/providers/trading/portfolio-identity'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthEnvironment,
} from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('TradingPortfolioIdentitiesRoute')

const getAccountLabel = (portfolioIdentity: PortfolioIdentity) =>
  portfolioIdentity.accountName ?? portfolioIdentity.accountId

const getAccountDescription = (portfolioIdentity: PortfolioIdentity) =>
  [portfolioIdentity.accountType, portfolioIdentity.accountStatus, portfolioIdentity.baseCurrency]
    .map((value) => (typeof value === 'string' && value.trim() !== 'unknown' ? value.trim() : ''))
    .filter(Boolean)
    .join(' - ')

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const providerId = searchParams.get('provider')?.trim() as TradingProviderId | undefined

  if (!providerId) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  }

  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = getTradingProviderDefinition(providerId)
  if (!provider?.oauth?.credentialServices?.length) {
    return NextResponse.json({ error: 'Unsupported trading provider' }, { status: 400 })
  }

  const portfolioIdentities = (
    await Promise.all(
      provider.oauth.credentialServices.map(async ({ serviceId }) => {
        try {
          const accessToken = await getOAuthToken(session.user.id, serviceId)
          const environment = getTradingProviderOAuthEnvironment(providerId, serviceId)
          if (!accessToken || !environment) return []

          return await listPortfolioIdentities({
            providerId,
            credentialServiceId: serviceId,
            environment,
            accessToken,
          })
        } catch (error) {
          logger.warn('Failed to list portfolio identities for credential service', {
            providerId,
            credentialServiceId: serviceId,
            error: error instanceof Error ? error.message : String(error),
          })
          return []
        }
      })
    )
  ).flat()

  return NextResponse.json({
    options: portfolioIdentities.map((portfolioIdentity) => {
      const description = getAccountDescription(portfolioIdentity)
      return {
        id: getPortfolioIdentityKey(portfolioIdentity),
        label: getAccountLabel(portfolioIdentity),
        rightLabel: description || portfolioIdentity.credentialServiceId,
        searchLabel: [
          getAccountLabel(portfolioIdentity),
          description,
          portfolioIdentity.providerName,
          portfolioIdentity.credentialServiceId,
          portfolioIdentity.accountId,
        ]
          .filter(Boolean)
          .join(' '),
        value: portfolioIdentity,
      }
    }),
  })
}
