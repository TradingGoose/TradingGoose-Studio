import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthTokenByCredentialId } from '@/lib/oauth/tokens'
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
  credentialServiceId: string
}

type PreflightContext = {
  requestId: string
  providerId: string
  credentialId: string
  credentialServiceId: string
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
    requestData.credentialServiceId,
    'credentialServiceId'
  )
  const serviceId = getTradingProviderOAuthServiceId(providerId, requestedServiceId)
  if (!serviceId) {
    throw new TradingServiceError('Trading provider connection is required')
  }

  const credentialId = requireStringField(requestData.credentialId, 'credentialId')

  const resolvedAccessToken = await getOAuthTokenByCredentialId({
    userId,
    credentialId,
    providerId: serviceId,
    requestId,
  })
  if (!resolvedAccessToken) {
    throw new TradingServiceError('Trading provider connection not found', 404)
  }
  const environment = getTradingProviderOAuthEnvironment(providerId, serviceId)
  if (!environment) {
    throw new TradingServiceError('Trading provider connection is not configured')
  }

  return {
    requestId,
    providerId,
    credentialId,
    credentialServiceId: serviceId,
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
      candidate.credentialServiceId === baseContext.credentialServiceId &&
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
      url: error.url,
      payload: error.payload,
    })
    return
  }

  logger.error(`Broker request failed in ${operation}`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
}
