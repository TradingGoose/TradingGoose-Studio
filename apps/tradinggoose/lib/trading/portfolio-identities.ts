import { listOAuthConnectionAccountsForUser } from '@/lib/credentials/oauth'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/tokens'
import { listPortfolioIdentities } from '@/providers/trading/portfolio'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthEnvironment,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'

export async function listTradingPortfolioIdentities({
  userId,
  providerId,
  serviceId,
  requestId,
}: {
  userId: string
  providerId: TradingProviderId
  serviceId?: string
  requestId: string
}) {
  const provider = getTradingProviderDefinition(providerId)
  const services = provider?.oauth?.services ?? []
  const serviceIds = services.map(({ serviceId }) => serviceId)
  const selectedServiceId = serviceId
    ? getTradingProviderOAuthServiceId(providerId, serviceId)
    : undefined
  if (serviceId && !selectedServiceId) return []

  const targetServiceIds = selectedServiceId ? [selectedServiceId] : serviceIds
  if (!targetServiceIds.length) return []

  const connections = await listOAuthConnectionAccountsForUser({
    userId,
    providerIds: targetServiceIds,
  })

  const identities = await Promise.allSettled(
    connections.map(async (connection) => {
      const environment = getTradingProviderOAuthEnvironment(providerId, connection.providerId)
      if (!environment) {
        throw new Error(`Unsupported trading service: ${connection.providerId}`)
      }

      const accessToken = await refreshAccessTokenIfNeeded(
        connection.tokenAccountId,
        connection.credentialOwnerUserId,
        requestId
      )
      if (!accessToken) {
        throw new Error(`Trading connection token unavailable: ${connection.tokenAccountId}`)
      }

      return listPortfolioIdentities({
        providerId,
        tokenAccountId: connection.tokenAccountId,
        serviceId: connection.providerId,
        environment,
        accessToken,
      })
    })
  )

  const fulfilled = identities.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : []
  )
  const hasRejectedIdentityLoad = identities.some((result) => result.status === 'rejected')
  if ((serviceId || !fulfilled.length) && hasRejectedIdentityLoad) {
    throw new Error('Failed to load trading portfolio identities')
  }

  return fulfilled.flat()
}
