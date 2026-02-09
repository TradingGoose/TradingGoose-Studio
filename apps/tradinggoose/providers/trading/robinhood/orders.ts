import { normalizeRobinhoodListingSymbol } from '@/providers/trading/robinhood/listing'
import type {
  TradingOrder,
  TradingOrderInput,
  TradingRequestConfig,
} from '@/providers/trading/types'

export const buildRobinhoodOrderRequest = (params: TradingOrderInput): TradingRequestConfig => {
  if (!params.accessToken) {
    throw new Error('Robinhood access token is required')
  }
  if (!params.instrumentUrl) {
    throw new Error('Instrument URL is required for Robinhood orders')
  }
  if (params.quantity === undefined || params.quantity === null) {
    throw new Error('Quantity is required for Robinhood orders')
  }

  const symbol = normalizeRobinhoodListingSymbol({
    listing: params.listing,
    base: params.base,
    quote: params.quote,
    assetClass: params.assetClass,
    marketCode: params.marketCode,
    countryCode: params.countryCode,
    cityName: params.cityName,
    timeZoneName: params.timeZoneName,
  })

  const body: Record<string, any> = {
    account: params.accountUrl,
    instrument: params.instrumentUrl,
    symbol,
    type: params.orderType || 'market',
    time_in_force: params.timeInForce || 'gfd',
    trigger: 'immediate',
    quantity: params.quantity,
    side: params.side,
    price: params.limitPrice,
  }

  if (body.type === 'market') {
    body.price = undefined
  }

  return {
    url: 'https://api.robinhood.com/orders/',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body,
  }
}

export const normalizeRobinhoodOrder = (data: any): TradingOrder => ({
  id: data?.id,
  status: data?.state,
  submittedAt: data?.created_at,
  filledQty: data?.quantity ? Number(data.quantity) : undefined,
  symbol: data?.symbol,
  side: data?.side,
  raw: data,
})
