import {
  listOAuthCredentialsForUser,
  resolveOAuthCredentialAccountForUser,
} from '@/lib/credentials/oauth'
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
  if (!provider) throw new Error('Unsupported trading provider')

  const services = provider?.oauth?.services ?? []
  const serviceIds = services.map(({ serviceId }) => serviceId)
  const selectedServiceId = serviceId
    ? getTradingProviderOAuthServiceId(providerId, serviceId)
    : undefined
  if (serviceId && !selectedServiceId) throw new Error('Trading provider connection is required')

  const targetServiceIds = selectedServiceId ? [selectedServiceId] : serviceIds
  if (!targetServiceIds.length) return []

  const credentials = await listOAuthCredentialsForUser({
    userId,
    workspaceId,
    providerIds: targetServiceIds,
  })

  const identities = await Promise.all(
    credentials.map(async (credential) => {
      const environment = getTradingProviderOAuthEnvironment(providerId, credential.provider)
      if (!environment) {
        throw new Error(`Unsupported trading service: ${credential.provider}`)
      }

      const credentialAccess = await resolveOAuthCredentialAccountForUser({
        credentialId: credential.id,
        userId,
        workspaceId,
      })
      if (!credentialAccess) {
        throw new Error(`Trading credential unavailable: ${credential.id}`)
      }

      const accessToken = await refreshAccessTokenIfNeeded(
        credentialAccess.accountId,
        credentialAccess.credentialOwnerUserId,
        requestId
      )
      if (!accessToken) {
        throw new Error(`Trading credential token unavailable: ${credential.id}`)
      }

      return listPortfolioIdentities({
        providerId,
        credentialId: credential.id,
        tokenAccountId: credentialAccess.accountId,
        serviceId: credential.provider,
        environment,
        accessToken,
      })
    })
  )

  return identities.flat()
}
