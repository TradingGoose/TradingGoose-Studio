import { db } from '@tradinggoose/db'
import { account, permissions, workflow as workflowTable, workspace } from '@tradinggoose/db/schema'
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { getOAuthTokenByCredentialId } from '@/lib/oauth/tokens'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { listPortfolioIdentities } from '@/providers/trading/portfolio'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthEnvironment,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'

type TradingCredentialRow = {
  id: string
  providerId: string
  userId: string
}

async function listTradingCredentials(params: {
  userId: string
  workflowId?: string
  targetServiceIds: string[]
}) {
  if (!params.workflowId) {
    return db
      .select({
        id: account.id,
        providerId: account.providerId,
        userId: account.userId,
      })
      .from(account)
      .where(and(eq(account.userId, params.userId), inArray(account.providerId, params.targetServiceIds)))
  }

  const [workflowScope] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, params.workflowId))
    .limit(1)
  if (!workflowScope?.workspaceId) return []

  const requesterAccess = await checkWorkspaceAccess(workflowScope.workspaceId, params.userId)
  if (!requesterAccess.canWrite) return []

  return db
    .select({
      id: account.id,
      providerId: account.providerId,
      userId: account.userId,
    })
    .from(account)
    .leftJoin(workspace, eq(workspace.id, workflowScope.workspaceId))
    .leftJoin(
      permissions,
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workflowScope.workspaceId),
        eq(permissions.userId, account.userId)
      )
    )
    .where(
      and(
        inArray(account.providerId, params.targetServiceIds),
        or(eq(account.userId, workspace.ownerId), isNotNull(permissions.userId))
      )
    )
}

export async function listTradingPortfolioIdentities({
  userId,
  workflowId,
  providerId,
  serviceId,
  requestId,
}: {
  userId: string
  workflowId?: string
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

  const credentials = (await listTradingCredentials({
    userId,
    workflowId,
    targetServiceIds,
  })) as TradingCredentialRow[]

  const identities = await Promise.allSettled(
    credentials.map(async (credential) => {
      const environment = getTradingProviderOAuthEnvironment(providerId, credential.providerId)
      if (!environment) {
        throw new Error(`Unsupported trading service: ${credential.providerId}`)
      }

      const accessToken = await getOAuthTokenByCredentialId({
        userId: credential.userId,
        credentialId: credential.id,
        providerId: credential.providerId,
        requestId,
      })
      if (!accessToken) {
        throw new Error(`Trading credential token unavailable: ${credential.id}`)
      }

      return listPortfolioIdentities({
        providerId,
        credentialId: credential.id,
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
