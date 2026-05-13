import { listOAuthCredentialAccountsForUser } from '@/lib/credentials/oauth'
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
  workspaceId,
  providerId,
  serviceId,
  requestId,
}: {
  userId: string
  workspaceId: string
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

  const credentials = await listOAuthCredentialAccountsForUser({
    userId,
    workspaceId,
    providerIds: targetServiceIds,
  })

  const identities = await Promise.allSettled(
    credentials.map(async (credential) => {
      const environment = getTradingProviderOAuthEnvironment(providerId, credential.providerId)
      if (!environment) {
        throw new Error(`Unsupported trading service: ${credential.providerId}`)
      }

      const accessToken = await refreshAccessTokenIfNeeded(
        credential.tokenAccountId,
        credential.credentialOwnerUserId,
        requestId
      )
      if (!accessToken) {
        throw new Error(`Trading credential token unavailable: ${credential.credentialId}`)
      }

      return listPortfolioIdentities({
        providerId,
        credentialId: credential.credentialId,
        serviceId: credential.providerId,
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
