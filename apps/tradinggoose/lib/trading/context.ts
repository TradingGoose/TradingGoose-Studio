import { db } from '@tradinggoose/db'
import { account, workflow as workflowTable } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthTokenByCredentialId } from '@/lib/oauth/tokens'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { TradingServiceError } from '@/lib/trading/errors'
import { listPortfolioIdentities } from '@/providers/trading/portfolio'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthEnvironment,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'

const logger = createLogger('TradingServices')

type ProviderRequestData = {
  provider: string
  credentialId: string
  serviceId: string
  workflowId?: string
  workspaceId?: string
}

type PreflightContext = {
  requestId: string
  providerId: string
  credentialId: string
  serviceId: string
  environment: 'paper' | 'live'
  accessToken: string
  sessionUserId: string
}

export type TradingProviderContext = PreflightContext

export type TradingAccountContext = PreflightContext & {
  accountId: string
  portfolioIdentity: PortfolioIdentity
}

const requireStringField = (input: string | undefined, field: string): string => {
  const value = input?.trim()
  if (!value) {
    throw new TradingServiceError(`${field} is required`)
  }
  return value
}

async function resolveCredentialWorkspaceScope(params: {
  workflowId?: string
  workspaceId?: string
}): Promise<string | null> {
  const workspaceId = params.workspaceId?.trim()
  if (!params.workflowId) return workspaceId || null

  const [row] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, params.workflowId))
    .limit(1)

  if (!row?.workspaceId) {
    throw new TradingServiceError('Workflow not found', 404)
  }
  if (workspaceId && workspaceId !== row.workspaceId) {
    throw new TradingServiceError('Workflow does not belong to workspace', 403)
  }
  return row.workspaceId
}

async function resolveTradingCredentialAccessToken(params: {
  actorUserId: string
  credentialId: string
  providerId: string
  requestId: string
  workflowId?: string
  workspaceId?: string
}) {
  const actorToken = await getOAuthTokenByCredentialId({
    userId: params.actorUserId,
    credentialId: params.credentialId,
    providerId: params.providerId,
    requestId: params.requestId,
  })
  if (actorToken) return actorToken

  const [credential] = await db
    .select({ userId: account.userId, providerId: account.providerId })
    .from(account)
    .where(eq(account.id, params.credentialId))
    .limit(1)

  if (!credential || credential.providerId !== params.providerId) {
    throw new TradingServiceError('Trading provider connection not found', 404)
  }

  if (credential.userId === params.actorUserId) {
    throw new TradingServiceError('Trading provider connection not found', 404)
  }

  const workspaceId = await resolveCredentialWorkspaceScope({
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
  })
  if (!workspaceId) {
    throw new TradingServiceError('workspaceId is required for shared trading credentials', 403)
  }

  const [actorAccess, ownerAccess] = await Promise.all([
    checkWorkspaceAccess(workspaceId, params.actorUserId),
    checkWorkspaceAccess(workspaceId, credential.userId),
  ])
  if (!actorAccess.hasAccess || !ownerAccess.hasAccess) {
    throw new TradingServiceError('Trading provider connection not found', 404)
  }

  const ownerToken = await getOAuthTokenByCredentialId({
    userId: credential.userId,
    credentialId: params.credentialId,
    providerId: params.providerId,
    requestId: params.requestId,
  })
  if (!ownerToken) {
    throw new TradingServiceError('Trading provider connection not found', 404)
  }

  return ownerToken
}

export async function resolveTradingProviderContext({
  requestData,
  requestId,
  userId,
}: {
  requestData: ProviderRequestData
  requestId: string
  userId: string
}): Promise<PreflightContext> {
  const providerId = requireStringField(requestData.provider, 'provider')

  const providerDefinition = getTradingProviderDefinition(providerId)
  if (!providerDefinition) {
    throw new TradingServiceError('Unsupported provider')
  }

  const requestedServiceId = requireStringField(
    requestData.serviceId,
    'serviceId'
  )
  const serviceId = getTradingProviderOAuthServiceId(providerId, requestedServiceId)
  if (!serviceId) {
    throw new TradingServiceError('Trading provider connection is required')
  }

  const credentialId = requireStringField(requestData.credentialId, 'credentialId')

  const resolvedAccessToken = await resolveTradingCredentialAccessToken({
    actorUserId: userId,
    credentialId,
    providerId: serviceId,
    requestId,
    workflowId: requestData.workflowId,
    workspaceId: requestData.workspaceId,
  })
  const environment = getTradingProviderOAuthEnvironment(providerId, serviceId)
  if (!environment) {
    throw new TradingServiceError('Trading provider connection is not configured')
  }

  return {
    requestId,
    providerId,
    credentialId,
    serviceId: serviceId,
    environment,
    accessToken: resolvedAccessToken,
    sessionUserId: userId,
  }
}

export async function resolveTradingProviderSelectedAccount({
  baseContext,
  accountId,
}: {
  baseContext: TradingProviderContext
  accountId?: string
}): Promise<TradingAccountContext> {
  const selectedAccountId = requireStringField(accountId, 'accountId')

  const portfolioIdentities = await listPortfolioIdentities(baseContext)

  const portfolioIdentity = portfolioIdentities.find(
    (candidate) =>
      candidate.providerId === baseContext.providerId &&
      candidate.credentialId === baseContext.credentialId &&
      candidate.serviceId === baseContext.serviceId &&
      candidate.accountId === selectedAccountId
  )
  if (!portfolioIdentity) {
    throw new TradingServiceError('Account not found for provider connection', 404)
  }

  return {
    ...baseContext,
    accountId: selectedAccountId,
    portfolioIdentity,
  }
}

export const createTradingRequestId = (operation: string) =>
  `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

export const logTradingBrokerRequestFailure = (operation: string, error: unknown) => {
  if (error instanceof TradingBrokerRequestError) {
    logger.error(`Broker request failed in ${operation}`, {
      error: error.message,
      stack: error.stack,
      providerId: error.providerId,
      status: error.status,
    })
    return
  }

  logger.error(`Broker request failed in ${operation}`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
}
