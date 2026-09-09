import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrAccountUrl } from '@/providers/trading/ibkr/client'
import { ibkrTradingProviderConfig } from '@/providers/trading/ibkr/config'
import { resolveIbkrConid, resolveIbkrConidSpec } from '@/providers/trading/ibkr/symbols'
import type {
  TradingOrder,
  TradingOrderInput,
  TradingRequestConfig,
} from '@/providers/trading/types'
import { listingIdentityToTradingSymbol } from '@/providers/trading/utils'

const IBKR_ORDER_TYPE: Record<string, string> = {
  market: 'MKT',
  limit: 'LMT',
  stop: 'STP',
  stop_limit: 'STP LMT',
  trailing_stop: 'TRAIL',
}

const IBKR_TIF: Record<string, string> = {
  day: 'DAY',
  gtc: 'GTC',
  ioc: 'IOC',
  fok: 'FOK',
  gtd: 'GTD',
}

const IBKR_SIDE: Record<string, string> = {
  buy: 'BUY',
  sell: 'SELL',
}

export const buildIbkrOrderRequest = (params: TradingOrderInput): TradingRequestConfig => {
  const authHeaders = buildIbkrAuthHeaders({ accessToken: params.accessToken })

  const symbol = listingIdentityToTradingSymbol(ibkrTradingProviderConfig, {
    listing: params.listing,
    base: params.base,
    quote: params.quote,
    assetClass: params.assetClass,
    marketCode: params.marketCode,
    countryCode: params.countryCode,
    cityName: params.cityName,
  })

  const orderSizingMode = params.orderSizingMode ?? 'quantity'
  if (orderSizingMode === 'notional') {
    throw new Error('IBKR orders do not support notional sizing.')
  }
  if (typeof params.quantity !== 'number' || !Number.isFinite(params.quantity)) {
    throw new Error('IBKR orders require quantity.')
  }

  const orderType = IBKR_ORDER_TYPE[params.orderType ?? 'market']
  if (!orderType) {
    throw new Error(`Unsupported order type: ${params.orderType}`)
  }
  const tif = IBKR_TIF[params.timeInForce ?? 'day']
  if (!tif) {
    throw new Error(`Unsupported time in force: ${params.timeInForce}`)
  }
  const side = IBKR_SIDE[params.side]
  if (!side) {
    throw new Error(`Unsupported side: ${params.side}`)
  }

  const { conid, conidSpec } = resolveIbkrConid({
    symbol,
    assetClass: params.assetClass,
  })

  const body: Record<string, any> = {
    conid,
    conidSpec: params.assetClass ? resolveIbkrConidSpec(params.assetClass) : conidSpec,
    side,
    quantity: String(Math.abs(params.quantity)),
    orderType,
    tif,
    outsideRth: false,
    ...(params.clientOrderId ? { orderRef: params.clientOrderId } : {}),
  }

  if (orderType === 'LMT' || orderType === 'STP LMT') {
    if (typeof params.limitPrice !== 'number' || !Number.isFinite(params.limitPrice)) {
      throw new Error('IBKR limit orders require limitPrice.')
    }
    body.price = params.limitPrice
  }
  if (orderType === 'STP' || orderType === 'STP LMT') {
    if (typeof params.stopPrice !== 'number' || !Number.isFinite(params.stopPrice)) {
      throw new Error('IBKR stop orders require stopPrice.')
    }
    body.auxPrice = params.stopPrice
  }
  if (orderType === 'TRAIL') {
    const hasTrailPrice =
      typeof params.trailPrice === 'number' && Number.isFinite(params.trailPrice)
    const hasTrailPercent =
      typeof params.trailPercent === 'number' && Number.isFinite(params.trailPercent)
    if (hasTrailPrice === hasTrailPercent) {
      throw new Error('IBKR trailing stop orders require either trailPrice or trailPercent.')
    }
    if (hasTrailPrice) {
      body.auxPrice = params.trailPrice
    } else {
      body.trailingPercent = params.trailPercent
    }
  }

  const accountId = params.accountId
  if (!accountId) {
    throw new Error('IBKR orders require accountId.')
  }

  return {
    url: buildIbkrAccountUrl(accountId, '/orders'),
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body,
  }
}

export const normalizeIbkrOrder = (data: any): TradingOrder => {
  const rawOrder = data?.order ?? data
  return {
    id: typeof rawOrder?.order_id === 'number' ? String(rawOrder.order_id) : rawOrder?.order_id,
    clientOrderId: rawOrder?.order_ref ?? rawOrder?.orderRef,
    status: rawOrder?.status,
    submittedAt: rawOrder?.last_update_time
      ? new Date(rawOrder.last_update_time * 1000).toISOString()
      : undefined,
    filledQty: typeof rawOrder?.filled === 'number' ? rawOrder.filled : undefined,
    symbol: rawOrder?.ticker,
    side: rawOrder?.side,
    raw: data,
  }
}
