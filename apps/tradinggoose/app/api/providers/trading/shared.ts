import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthTokenByCredentialId } from '@/app/api/auth/oauth/utils'
import { listPortfolioIdentities } from '@/providers/trading/portfolio'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthEnvironment,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'

const logger = createLogger('TradingProviderRoutes')

type ProviderRequestData = {
  provider?: string
  credentialId?: string
  credentialServiceId?: string
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

export type TradingProviderBaseRouteContext = PreflightContext

export type TradingAccountRouteContext = PreflightContext & {
  accountId: string
  portfolioIdentity: PortfolioIdentity
}

const parseRequestBody = async <T extends Record<string, unknown>>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<T | NextResponse> => {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
  }

  return parsed.data
}

const requireStringField = (
  data: Record<string, string | undefined>,
  field: string
): string | NextResponse => {
  const value = data[field]?.trim()
  if (!value) {
    return NextResponse.json({ error: `${field} is required` }, { status: 400 })
  }
  return value
}

export async function resolveTradingProviderPreflight<T extends Record<string, unknown>>({
  request,
  schema,
}: {
  request: Request
  schema: z.ZodSchema<T>
}): Promise<T | NextResponse> {
  return parseRequestBody(request, schema)
}

export async function resolveTradingProviderContext({
  requestData,
  requestId,
  userId,
  accessToken,
}: {
  requestData: ProviderRequestData
  requestId: string
  userId: string
  accessToken?: string
}): Promise<PreflightContext | NextResponse> {
  const providerId = requireStringField(requestData, 'provider')
  if (providerId instanceof NextResponse) return providerId

  const providerDefinition = getTradingProviderDefinition(providerId)
  if (!providerDefinition) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  }

  const serviceId = getTradingProviderOAuthServiceId(providerId, requestData.credentialServiceId)
  if (!serviceId) {
    return NextResponse.json({ error: 'Trading provider connection is required' }, { status: 400 })
  }

  const credentialId = requireStringField(requestData, 'credentialId')
  if (credentialId instanceof NextResponse) return credentialId

  const resolvedAccessToken =
    typeof accessToken === 'string'
      ? accessToken.trim()
      : await getOAuthTokenByCredentialId({
          userId,
          credentialId,
          providerId: serviceId,
          requestId,
        })
  if (!resolvedAccessToken) {
    return NextResponse.json({ error: 'Trading provider connection not found' }, { status: 404 })
  }
  const environment = getTradingProviderOAuthEnvironment(providerId, serviceId)
  if (!environment) {
    return NextResponse.json(
      { error: 'Trading provider connection is not configured' },
      { status: 400 }
    )
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
  baseContext: TradingProviderBaseRouteContext
  accountId?: string
}): Promise<TradingAccountRouteContext | NextResponse> {
  const selectedAccountId = requireStringField({ accountId }, 'accountId')
  if (selectedAccountId instanceof NextResponse) return selectedAccountId

  const portfolioIdentities = await listPortfolioIdentities(baseContext)

  const portfolioIdentity = portfolioIdentities.find(
    (candidate) =>
      candidate.providerId === baseContext.providerId &&
      candidate.credentialId === baseContext.credentialId &&
      candidate.credentialServiceId === baseContext.credentialServiceId &&
      candidate.accountId === selectedAccountId
  )
  if (!portfolioIdentity) {
    return NextResponse.json(
      { error: 'Account not found for provider connection' },
      { status: 404 }
    )
  }

  return {
    ...baseContext,
    accountId: selectedAccountId,
    portfolioIdentity,
  }
}

export const createTradingProviderRequestId = (route: string) =>
  `${route}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

export const logBrokerRequestFailure = (route: string, error: unknown) => {
  if (error instanceof TradingBrokerRequestError) {
    logger.error(`Broker request failed in ${route}`, {
      error: error.message,
      stack: error.stack,
      providerId: error.providerId,
      status: error.status,
      url: error.url,
      payload: error.payload,
    })
    return
  }

  logger.error(`Broker request failed in ${route}`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
}
