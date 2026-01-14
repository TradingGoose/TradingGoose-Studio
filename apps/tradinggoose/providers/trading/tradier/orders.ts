import type {
  TradingOrder,
  TradingOrderInput,
  TradingRequestConfig,
} from '@/providers/trading/types'
import { resolveTradingSymbol } from '@/providers/trading/utils'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'

export const buildTradierOrderRequest = (
  params: TradingOrderInput
): TradingRequestConfig => {
  if (!params.accessToken) {
    throw new Error('Tradier access token is required')
  }
  if (!params.accountId) {
    throw new Error('Tradier account ID is required')
  }

  const symbol = resolveTradingSymbol(tradierTradingProviderConfig, {
    symbol: params.symbol,
    listing: params.listing,
    base: params.base,
    quote: params.quote,
    assetClass: params.assetClass,
    micCode: params.micCode,
    countryCode: params.countryCode,
    cityName: params.cityName,
    timeZoneName: params.timeZoneName,
  })

  const bodyParams = new URLSearchParams({
    class: 'equity',
    symbol,
    side: params.side,
    quantity: String(params.quantity),
    type: params.orderType || 'market',
    duration: params.timeInForce || 'day',
  })

  if (params.limitPrice) {
    bodyParams.append('price', String(params.limitPrice))
  }
  if (params.stopPrice) {
    bodyParams.append('stop', String(params.stopPrice))
  }

  return {
    url: `https://api.tradier.com/v1/accounts/${params.accountId}/orders`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: bodyParams.toString(),
  }
}

export const normalizeTradierOrder = (data: any): TradingOrder => {
  const order = data?.order || data
  return {
    id: order?.id || order?.order?.id,
    status: order?.status,
    submittedAt: order?.date || order?.created_at,
    filledQty: order?.quantity ? Number(order.quantity) : undefined,
    symbol: order?.symbol,
    side: order?.side,
    raw: order || data,
  }
}
