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

  const quantity =
    typeof params.quantity === 'number' && Number.isFinite(params.quantity)
      ? params.quantity
      : undefined
  const notional =
    typeof params.notional === 'number' && Number.isFinite(params.notional)
      ? params.notional
      : undefined
  const sizingMode = (params as { orderSizingMode?: string }).orderSizingMode
  const resolvedSizingMode =
    sizingMode === 'quantity' || sizingMode === 'notional' ? sizingMode : undefined

  if (resolvedSizingMode === 'quantity' && quantity === undefined) {
    throw new Error('Alpaca orders require qty when orderSizingMode=quantity.')
  }
  if (resolvedSizingMode === 'notional' && notional === undefined) {
    throw new Error('Alpaca orders require notional when orderSizingMode=notional.')
  }

  const useQuantity =
    resolvedSizingMode === 'quantity'
      ? quantity !== undefined
      : resolvedSizingMode === 'notional'
        ? false
        : quantity !== undefined
  const useNotional =
    resolvedSizingMode === 'notional'
      ? notional !== undefined
      : !useQuantity && notional !== undefined

  if (!useNotional && !useQuantity) {
    throw new Error('Alpaca orders require qty or notional.')
  }

  const orderType = (params.orderType || 'market').toLowerCase()
  const timeInForce = params.timeInForce || 'day'
  const isTrailingStop = orderType === 'trailing_stop'

  if (useNotional) {
    const supportedTypes = new Set(['market', 'limit', 'stop', 'stop_limit'])
    if (!supportedTypes.has(orderType)) {
      throw new Error('Alpaca notional orders support market, limit, stop, or stop_limit types.')
    }
    if (timeInForce !== 'day') {
      throw new Error('Alpaca notional orders require time_in_force=day.')
    }
  }

  const body: Record<string, any> = {
    symbol,
    side: params.side,
    type: orderType,
    time_in_force: timeInForce,
  }

  if (useNotional) {
    body.notional = notional
  } else {
    body.qty = String(quantity)
  }

  const hasLimitComponent = orderType === 'limit' || orderType === 'stop_limit'
  const hasStopComponent = orderType === 'stop' || orderType === 'stop_limit'

  if (hasLimitComponent && params.limitPrice !== undefined) {
    body.limit_price = params.limitPrice
  }
  if (hasStopComponent && params.stopPrice !== undefined) {
    body.stop_price = params.stopPrice
  }

  if (isTrailingStop) {
    if (params.limitPrice !== undefined || params.stopPrice !== undefined) {
      throw new Error('Trailing stop orders use trail_price or trail_percent, not limit/stop price.')
    }
    const trailPrice =
      typeof params.trailPrice === 'number' && Number.isFinite(params.trailPrice)
        ? params.trailPrice
        : undefined
    const trailPercent =
      typeof params.trailPercent === 'number' && Number.isFinite(params.trailPercent)
        ? params.trailPercent
        : undefined

    if (
      (trailPrice === undefined && trailPercent === undefined) ||
      (trailPrice !== undefined && trailPercent !== undefined)
    ) {
      throw new Error('Trailing stop orders require either trailPrice or trailPercent.')
    }
    if (trailPrice !== undefined) {
      body.trail_price = trailPrice
    }
    if (trailPercent !== undefined) {
      body.trail_percent = trailPercent
    }
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
