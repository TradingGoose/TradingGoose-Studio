import { NextResponse } from 'next/server'
import {
  createTradingWidgetRequestId,
  logBrokerRequestFailure,
  resolveTradingWidgetPerformanceContext,
  resolveTradingWidgetPreflight,
  tradingPerformanceIdentitySchema,
} from '@/app/api/widgets/trading/shared'
import {
  getTradingAccountPerformance,
  getTradingPortfolioSupportedWindows,
  isTradingPortfolioWindowSupported,
} from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = createTradingWidgetRequestId('performance')
  const requestData = await resolveTradingWidgetPreflight({
    request,
    requestId,
    schema: tradingPerformanceIdentitySchema,
  })
  if (requestData instanceof Response) {
    return requestData
  }

  const providerId = requestData.provider?.trim()
  const window = requestData.window?.trim()
  const supportedWindows = providerId ? getTradingPortfolioSupportedWindows(providerId) : []

  if (
    providerId &&
    window &&
    supportedWindows.length > 0 &&
    !isTradingPortfolioWindowSupported(providerId, window)
  ) {
    return NextResponse.json({ error: 'Unsupported performance window' }, { status: 400 })
  }

  try {
    const context = await resolveTradingWidgetPerformanceContext({
      requestData,
      requestId,
    })
    if (context instanceof Response) {
      return context
    }

    const performance = await getTradingAccountPerformance({
      providerId: context.providerId,
      environment: context.environment,
      accessToken: context.accessToken,
      accountId: context.accountId,
      window: context.window as any,
    })

    return NextResponse.json({ performance })
  } catch (error) {
    if (error instanceof TradingBrokerRequestError) {
      logBrokerRequestFailure('performance', error)
      return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
    }

    logBrokerRequestFailure('performance', error)
    return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
  }
}
