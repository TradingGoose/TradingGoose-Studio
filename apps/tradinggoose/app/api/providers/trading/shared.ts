import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { listTradingAccounts } from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import {
  getTradingProviderDefinition,
  getTradingProviderOAuthEnvironment,
  getTradingProviderOAuthServiceId,
} from '@/providers/trading/providers'
import type { UnifiedTradingAccount } from '@/providers/trading/types'

const logger = createLogger('TradingProviderRoutes')

type ProviderRequestData = {
  provider?: string
  credentialServiceId?: string
}

type PreflightContext = {
  requestId: string
  providerId: string
  environment: 'paper' | 'live'
  accessToken: string
  sessionUserId: string
}

export type TradingProviderBaseRouteContext = PreflightContext

export type TradingAccountRouteContext = PreflightContext & {
  accountId: string
  account: UnifiedTradingAccount
}

const parseRequestBody = async <T extends ProviderRequestData>(
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

export async function resolveTradingProviderPreflight<T extends ProviderRequestData>({
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
}: {
  requestData: ProviderRequestData
  requestId: string
}): Promise<PreflightContext | NextResponse> {
  const providerId = requireStringField(requestData, 'provider')
  if (providerId instanceof NextResponse) return providerId

  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const providerDefinition = getTradingProviderDefinition(providerId)
  if (!providerDefinition) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  }

  const serviceId = getTradingProviderOAuthServiceId(providerId, requestData.credentialServiceId)
  if (!serviceId) {
    return NextResponse.json({ error: 'Trading provider connection is required' }, { status: 400 })
  }

  const accessToken = await getOAuthToken(session.user.id, serviceId)
  if (!accessToken) {
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
    environment,
    accessToken,
    sessionUserId: session.user.id,
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

  const accounts = await listTradingAccounts({
    providerId: baseContext.providerId,
    environment: baseContext.environment,
    accessToken: baseContext.accessToken,
  })

  const account = accounts.find((candidate) => candidate.id === selectedAccountId)
  if (!account) {
    return NextResponse.json(
      { error: 'Account not found for provider connection' },
      { status: 404 }
    )
  }

  return {
    ...baseContext,
    accountId: selectedAccountId,
    account,
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
