import type {
  TradingOrder,
  TradingOrderInput,
  TradingRequestConfig,
} from '@/providers/trading/types'
import { resolveTradingSymbol } from '@/providers/trading/utils'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'
import { buildAlpacaAuthHeaders } from '@/providers/trading/alpaca/auth'

export const buildAlpacaOrderRequest = (
  params: TradingOrderInput
): TradingRequestConfig => {
  const authHeaders = buildAlpacaAuthHeaders(params)

  const baseUrl =
    params.environment === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets'

  const symbol = resolveTradingSymbol(alpacaTradingProviderConfig, {
    listing: params.listing,
    base: params.base,
    quote: params.quote,
    assetClass: params.assetClass,
    micCode: params.micCode,
    countryCode: params.countryCode,
    cityName: params.cityName,
    timeZoneName: params.timeZoneName,
  })

  const body: Record<string, any> = {
    symbol,
    qty: String(params.quantity),
    side: params.side,
    type: (params.orderType || 'market').toLowerCase(),
    time_in_force: params.timeInForce || 'day',
  }

  const orderType = body.type
  const hasLimitComponent = orderType === 'limit' || orderType === 'stop_limit'
  const hasStopComponent = orderType === 'stop' || orderType === 'stop_limit'

  if (hasLimitComponent && params.limitPrice !== undefined) {
    body.limit_price = params.limitPrice
  }
  if (hasStopComponent && params.stopPrice !== undefined) {
    body.stop_price = params.stopPrice
  }

  return {
    url: `${baseUrl}/v2/orders`,
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body,
  }
}

export const normalizeAlpacaOrder = (data: any): TradingOrder => ({
  id: data?.id,
  status: data?.status,
  submittedAt: data?.submitted_at,
  filledQty: data?.filled_qty ? Number(data.filled_qty) : undefined,
  symbol: data?.symbol,
  side: data?.side,
  raw: data,
})
