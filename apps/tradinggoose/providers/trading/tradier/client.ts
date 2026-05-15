import type { TradingHoldingsInput, TradingOrderInput } from '@/providers/trading/types'

const TRADIER_BASE_URL = 'https://api.tradier.com/v1'

export const resolveTradierBaseUrl = () => TRADIER_BASE_URL

export const buildTradierAuthHeaders = (
  params: TradingOrderInput | TradingHoldingsInput
): Record<string, string> => {
  if (!params.accessToken) {
    throw new Error('Tradier access token is required')
  }

  return {
    Authorization: `Bearer ${params.accessToken}`,
  }
}
