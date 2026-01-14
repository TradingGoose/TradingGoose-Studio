import type {
  TradingHoldingsInput,
  TradingOpenPosition,
  TradingRequestConfig,
} from '@/providers/trading/types'
import { buildAlpacaAuthHeaders } from '@/providers/trading/alpaca/auth'

export const buildAlpacaHoldingsRequest = (
  params: TradingHoldingsInput
): TradingRequestConfig => {
  const authHeaders = buildAlpacaAuthHeaders(params)

  const baseUrl =
    params.environment === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets'

  return {
    url: `${baseUrl}/v2/positions`,
    method: 'GET',
    headers: authHeaders,
  }
}

export const normalizeAlpacaHoldings = (data: any): TradingOpenPosition[] => {
  const positions = Array.isArray(data) ? data : data?.positions || data
  if (!Array.isArray(positions)) return []
  return positions.map((position: any) => ({
    symbol: position?.symbol,
    quantity: position?.qty
      ? Number(position.qty)
      : Number(position.quantity) || 0,
    avgPrice: position?.avg_entry_price ? Number(position.avg_entry_price) : undefined,
    marketValue: position?.market_value ? Number(position.market_value) : undefined,
    raw: position,
  }))
}
