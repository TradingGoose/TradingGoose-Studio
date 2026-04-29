import { NextResponse } from 'next/server'
import {
  createTradingProviderRequestId,
  logBrokerRequestFailure,
  resolveTradingProviderContext,
  resolveTradingProviderPreflight,
  tradingAccountIdentitySchema,
} from '@/app/api/providers/trading/shared'
import { listTradingAccounts } from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = createTradingProviderRequestId('accounts')
  const requestData = await resolveTradingProviderPreflight({
    request,
    requestId,
    schema: tradingAccountIdentitySchema.pick({
      provider: true,
      credentialId: true,
      environment: true,
    }),
  })
  if (requestData instanceof Response) {
    return requestData
  }

  const context = await resolveTradingProviderContext({ requestData, requestId })
  if (context instanceof Response) {
    return context
  }

  try {
    const accounts = await listTradingAccounts({
      providerId: context.providerId,
      environment: context.environment,
      accessToken: context.accessToken,
    })

    return NextResponse.json({ accounts })
  } catch (error) {
    if (error instanceof TradingBrokerRequestError) {
      logBrokerRequestFailure('accounts', error)
      return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
    }

    logBrokerRequestFailure('accounts', error)
    return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
  }
}
