import {
  listOAuthConnectionAccountsForUser,
  resolveOAuthConnectionAccountForUser,
} from '@/lib/credentials/oauth'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/tokens'
import { listPortfolioIdentities } from '@/providers/trading/portfolio'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthEnvironment,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'

type OAuthConnectionAccount = {
  tokenAccountId: string
  providerId: string
  credentialOwnerUserId: string
}

async function listConnectionPortfolioIdentities({
  connection,
  providerId,
  requestId,
}: {
  connection: OAuthConnectionAccount
  providerId: TradingProviderId
  requestId: string
}) {
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
    credentialId: connection.tokenAccountId,
    tokenAccountId: connection.tokenAccountId,
    serviceId: connection.providerId,
    environment,
    accessToken,
  })
}

export async function listTradingPortfolioIdentities({
  userId,
  providerId,
  serviceId,
  credentialId,
  requestId,
}: {
  userId: string
  providerId: TradingProviderId
  serviceId?: string
  credentialId?: string
  requestId: string
}) {
  const provider = getTradingProviderDefinition(providerId)
  if (!provider) throw new Error('Unsupported trading provider')

  const services = provider.oauth?.services ?? []
  const serviceIds = services.map(({ serviceId }) => serviceId)
  const selectedServiceId = serviceId
    ? getTradingProviderOAuthServiceId(providerId, serviceId)
    : undefined
  if (serviceId && !selectedServiceId) throw new Error('Trading provider connection is required')

  const targetServiceIds = selectedServiceId ? [selectedServiceId] : serviceIds
  if (!targetServiceIds.length) return []

  if (credentialId) {
    const connection = await resolveOAuthConnectionAccountForUser({
      accountId: credentialId,
      userId,
    })
    if (!connection || !targetServiceIds.includes(connection.providerId)) {
      throw new Error(`Trading connection unavailable: ${credentialId}`)
    }
    return listConnectionPortfolioIdentities({
      connection,
      providerId,
      requestId,
    })
  }

  const connections = await listOAuthConnectionAccountsForUser({
    userId,
    providerIds: targetServiceIds,
  })
  if (!connections.length) return []

  const identityRequests = connections.map((connection) =>
    listConnectionPortfolioIdentities({
      connection,
      providerId,
      requestId,
    })
  )

  const settled = await Promise.allSettled(identityRequests)
  const identities = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )
  if (identities.length > 0) return identities

  const firstFailure = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (firstFailure) throw firstFailure.reason

  return []
}
