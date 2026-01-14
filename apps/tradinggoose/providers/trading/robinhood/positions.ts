import type {
  TradingHoldingsInput,
  TradingOpenPosition,
  TradingRequestConfig,
} from '@/providers/trading/types'

export const buildRobinhoodHoldingsRequest = (
  params: TradingHoldingsInput
): TradingRequestConfig => {
  if (!params.accessToken) {
    throw new Error('Robinhood access token is required')
  }

  const searchParams = new URLSearchParams()
  if (params.accountUrl) {
    searchParams.append('account', params.accountUrl)
  }

  return {
    url: `https://api.robinhood.com/positions/${searchParams.toString() ? `?${searchParams.toString()}` : ''}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  }
}

export const normalizeRobinhoodHoldings = (data: any): TradingOpenPosition[] => {
  const positions = data?.results || []
  return positions.map((position: any) => ({
    symbol: position?.symbol,
    quantity: position?.quantity ? Number(position.quantity) : 0,
    avgPrice: position?.average_buy_price
      ? Number(position.average_buy_price)
      : undefined,
    marketValue: position?.market_value ? Number(position.market_value) : undefined,
    raw: position,
  }))
}
