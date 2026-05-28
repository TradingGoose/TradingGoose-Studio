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

type OAuthCredential = Awaited<ReturnType<typeof listOAuthCredentialsForUser>>[number]

async function listCredentialPortfolioIdentities({
  credential,
  providerId,
  userId,
  workspaceId,
  requestId,
}: {
  credential: OAuthCredential
  providerId: TradingProviderId
  userId: string
  workspaceId: string
  requestId: string
}) {
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
}

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
  if (!credentials.length) return []

  const identityRequests = credentials.map((credential) =>
    listCredentialPortfolioIdentities({
      credential,
      providerId,
      userId,
      workspaceId,
      requestId,
    })
  )

  const settled = await Promise.allSettled(identityRequests)
  const identities = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )
  if (settled.some((result) => result.status === 'fulfilled')) return identities

  const firstFailure = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (firstFailure) throw firstFailure.reason

  return []
}
