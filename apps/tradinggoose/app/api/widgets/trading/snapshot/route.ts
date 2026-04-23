import { NextResponse } from 'next/server'
import {
  createTradingWidgetRequestId,
  logBrokerRequestFailure,
  resolveTradingWidgetAccountContext,
  resolveTradingWidgetPreflight,
  tradingAccountIdentitySchema,
} from '@/app/api/widgets/trading/shared'
import { getTradingAccountSnapshot } from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'

export const dynamic = 'force-dynamic'

const mergeSnapshotAccountMetadata = ({
  snapshot,
  selectedAccount,
}: {
  snapshot: Awaited<ReturnType<typeof getTradingAccountSnapshot>>
  selectedAccount: {
    id: string
    name?: string
    type: Awaited<ReturnType<typeof getTradingAccountSnapshot>>['account']['type']
    baseCurrency: string
    status?: Awaited<ReturnType<typeof getTradingAccountSnapshot>>['account']['status']
  }
}) => ({
  ...snapshot.account,
  id: selectedAccount.id,
  name: snapshot.account.name ?? selectedAccount.name,
  type: snapshot.account.type === 'unknown' ? selectedAccount.type : snapshot.account.type,
  baseCurrency: snapshot.account.baseCurrency || selectedAccount.baseCurrency,
  status:
    !snapshot.account.status || snapshot.account.status === 'unknown'
      ? selectedAccount.status
      : snapshot.account.status,
})

export async function POST(request: Request) {
  const requestId = createTradingWidgetRequestId('snapshot')
  const requestData = await resolveTradingWidgetPreflight({
    request,
    requestId,
    schema: tradingAccountIdentitySchema,
  })
  if (requestData instanceof Response) {
    return requestData
  }

  try {
    const context = await resolveTradingWidgetAccountContext({
      requestData,
      requestId,
    })
    if (context instanceof Response) {
      return context
    }

    const snapshot = await getTradingAccountSnapshot({
      providerId: context.providerId,
      environment: context.environment,
      accessToken: context.accessToken,
      accountId: context.accountId,
    })

    return NextResponse.json({
      snapshot: {
        ...snapshot,
        account: mergeSnapshotAccountMetadata({
          snapshot,
          selectedAccount: context.account,
        }),
      },
    })
  } catch (error) {
    if (error instanceof TradingBrokerRequestError) {
      logBrokerRequestFailure('snapshot', error)
      return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
    }

    logBrokerRequestFailure('snapshot', error)
    return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
  }
}
