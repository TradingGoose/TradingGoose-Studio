import type {
  TradingHoldingsInput,
  TradingOpenPosition,
  TradingRequestConfig,
} from '@/providers/trading/types'

export const buildTradierHoldingsRequest = (
  params: TradingHoldingsInput
): TradingRequestConfig => {
  if (!params.accessToken) {
    throw new Error('Tradier access token is required')
  }
  if (!params.accountId) {
    throw new Error('Tradier account ID is required')
  }

  return {
    url: `https://api.tradier.com/v1/accounts/${params.accountId}/positions`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  }
}

export const normalizeTradierHoldings = (data: any): TradingOpenPosition[] => {
  const positions = data?.positions?.position || data?.position || []
  const list = Array.isArray(positions) ? positions : [positions].filter(Boolean)
  return list.map((position: any) => ({
    symbol: position?.symbol,
    quantity: position?.quantity ? Number(position.quantity) : 0,
    avgPrice: position?.cost_basis ? Number(position.cost_basis) : undefined,
    marketValue: position?.market_value ? Number(position.market_value) : undefined,
    raw: position,
  }))
}
