import { db } from '@tradinggoose/db'
import { account } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { getOAuthTokenByCredentialId } from '@/app/api/auth/oauth/utils'
import { listPortfolioIdentities } from '@/providers/trading/portfolio'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthEnvironment,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'

export async function listUserTradingPortfolioIdentities({
  userId,
  providerId,
  credentialServiceId,
  requestId,
}: {
  userId: string
  providerId: TradingProviderId
  credentialServiceId?: string
  requestId: string
}) {
  const provider = getTradingProviderDefinition(providerId)
  const credentialServices = provider?.oauth?.credentialServices ?? []
  const serviceIds = credentialServices.map(({ serviceId }) => serviceId)
  const selectedServiceId = credentialServiceId
    ? getTradingProviderOAuthServiceId(providerId, credentialServiceId)
    : undefined
  if (credentialServiceId && !selectedServiceId) return []

  const targetServiceIds = selectedServiceId ? [selectedServiceId] : serviceIds
  if (!targetServiceIds.length) return []

  const credentials = await db
    .select({
      id: account.id,
      providerId: account.providerId,
    })
    .from(account)
    .where(and(eq(account.userId, userId), inArray(account.providerId, targetServiceIds)))

  const identities = await Promise.allSettled(
    credentials.map(async (credential) => {
      const environment = getTradingProviderOAuthEnvironment(providerId, credential.providerId)
      if (!environment) return []

      const accessToken = await getOAuthTokenByCredentialId({
        userId,
        credentialId: credential.id,
        providerId: credential.providerId,
        requestId,
      })
      if (!accessToken) return []

      return listPortfolioIdentities({
        providerId,
        credentialId: credential.id,
        credentialServiceId: credential.providerId,
        environment,
        accessToken,
      })
    })
  )

  return identities.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}
