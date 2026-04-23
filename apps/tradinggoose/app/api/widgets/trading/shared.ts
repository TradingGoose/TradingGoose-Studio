import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { parseProvider } from '@/lib/oauth'
import { getCredential, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { listTradingAccounts } from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import {
  getTradingProviderDefinition,
  getTradingProviderParamDefinitions,
} from '@/providers/trading/providers'
import type { UnifiedTradingAccount } from '@/providers/trading/types'

const logger = createLogger('TradingWidgetRoutes')

const environmentSchema = z.object({
  provider: z.string().optional(),
  credentialId: z.string().optional(),
  environment: z.string().optional(),
})

export const tradingAccountIdentitySchema = environmentSchema.extend({
  accountId: z.string().optional(),
})

export const tradingPerformanceIdentitySchema = tradingAccountIdentitySchema.extend({
  window: z.string().optional(),
})

type EnvironmentRequestData = z.infer<typeof environmentSchema>
type TradingAccountIdentityData = z.infer<typeof tradingAccountIdentitySchema>
type TradingPerformanceIdentityData = z.infer<typeof tradingPerformanceIdentitySchema>

type PreflightContext = {
  requestId: string
  providerId: string
  credentialId: string
  environment: 'paper' | 'live'
  accessToken: string
  sessionUserId: string
}

export type TradingAccountRouteContext = PreflightContext & {
  accountId: string
  account: UnifiedTradingAccount
}

export type TradingPerformanceRouteContext = TradingAccountRouteContext & {
  window: string
}

const getSupportedEnvironments = (providerId: string) => {
  const environmentDefinition = getTradingProviderParamDefinitions(providerId, 'holdings').find(
    (definition) => definition.id === 'environment'
  )
  return new Set(
    (environmentDefinition?.options ?? [])
      .map((option) => option.id)
      .filter((value): value is 'paper' | 'live' => value === 'paper' || value === 'live')
  )
}

const parseRequestBody = async <T extends EnvironmentRequestData>(
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

export async function resolveTradingWidgetPreflight<T extends EnvironmentRequestData>({
  request,
  requestId,
  schema,
}: {
  request: Request
  requestId: string
  schema: z.ZodSchema<T>
}): Promise<T | NextResponse> {
  return parseRequestBody(request, schema)
}

export async function resolveTradingWidgetContext({
  requestData,
  requestId,
}: {
  requestData: EnvironmentRequestData
  requestId: string
}): Promise<PreflightContext | NextResponse> {
  const providerId = requireStringField(requestData, 'provider')
  if (providerId instanceof NextResponse) return providerId

  const credentialId = requireStringField(requestData, 'credentialId')
  if (credentialId instanceof NextResponse) return credentialId

  const environment = requireStringField(requestData, 'environment')
  if (environment instanceof NextResponse) return environment

  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const providerDefinition = getTradingProviderDefinition(providerId)
  if (!providerDefinition) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  }

  const supportedEnvironments = getSupportedEnvironments(providerId)
  if (!supportedEnvironments.has(environment as 'paper' | 'live')) {
    return NextResponse.json({ error: 'Unsupported environment' }, { status: 400 })
  }

  const credential = await getCredential(requestId, credentialId, session.user.id)
  if (!credential) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
  }

  const credentialProvider = parseProvider(credential.providerId).baseProvider
  const requestedProvider = parseProvider(providerId).baseProvider
  if (credentialProvider !== requestedProvider) {
    return NextResponse.json({ error: 'Credential does not match provider' }, { status: 400 })
  }

  const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)
  if (!accessToken) {
    return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
  }

  return {
    requestId,
    providerId,
    credentialId,
    environment: environment as 'paper' | 'live',
    accessToken,
    sessionUserId: session.user.id,
  }
}

export async function resolveTradingWidgetAccountContext({
  requestData,
  requestId,
}: {
  requestData: TradingAccountIdentityData
  requestId: string
}): Promise<TradingAccountRouteContext | NextResponse> {
  const accountId = requireStringField(requestData, 'accountId')
  if (accountId instanceof NextResponse) return accountId

  const baseContext = await resolveTradingWidgetContext({ requestData, requestId })
  if (baseContext instanceof Response) {
    return baseContext
  }

  const accounts = await listTradingAccounts({
    providerId: baseContext.providerId,
    environment: baseContext.environment,
    accessToken: baseContext.accessToken,
  })

  const account = accounts.find((candidate) => candidate.id === accountId)
  if (!account) {
    return NextResponse.json({ error: 'Account not found for credential' }, { status: 404 })
  }

  return {
    ...baseContext,
    accountId,
    account,
  }
}

export async function resolveTradingWidgetPerformanceContext({
  requestData,
  requestId,
}: {
  requestData: TradingPerformanceIdentityData
  requestId: string
}): Promise<TradingPerformanceRouteContext | NextResponse> {
  const window = requireStringField(requestData, 'window')
  if (window instanceof NextResponse) return window

  const accountContext = await resolveTradingWidgetAccountContext({
    requestData,
    requestId,
  })
  if (accountContext instanceof Response) {
    return accountContext
  }

  return {
    ...accountContext,
    window,
  }
}

export const createTradingWidgetRequestId = (route: string) =>
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
