import { NextResponse } from 'next/server'
import {
  createTradingWidgetRequestId,
  logBrokerRequestFailure,
  resolveTradingWidgetContext,
  resolveTradingWidgetPreflight,
  tradingAccountIdentitySchema,
} from '@/app/api/widgets/trading/shared'
import { listTradingAccounts } from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = createTradingWidgetRequestId('accounts')
  const requestData = await resolveTradingWidgetPreflight({
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

  const context = await resolveTradingWidgetContext({ requestData, requestId })
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
