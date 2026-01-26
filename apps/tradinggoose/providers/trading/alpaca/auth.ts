import type { TradingHoldingsInput, TradingOrderInput } from '@/providers/trading/types'

export const buildAlpacaAuthHeaders = (
  params: TradingOrderInput | TradingHoldingsInput
): Record<string, string> => {
  if (params.accessToken) {
    return { Authorization: `Bearer ${params.accessToken}` }
  }

  if (!params.apiKey || !params.apiSecret) {
    throw new Error('Alpaca access token or API key/secret are required')
  }

  return {
    'APCA-API-KEY-ID': params.apiKey,
    'APCA-API-SECRET-KEY': params.apiSecret,
  }
}
