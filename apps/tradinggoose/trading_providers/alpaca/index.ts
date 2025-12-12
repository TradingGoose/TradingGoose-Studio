import type { TradingProviderDefinition } from '@/trading_providers/types'

export const alpacaProvider: TradingProviderDefinition = {
  id: 'alpaca',
  name: 'Alpaca',
  description: 'Commission-free trading via Alpaca (paper and live).',
  authType: 'apiKey',
  credentialFields: [
    { id: 'apiKey', label: 'API Key', description: 'APCA-API-KEY-ID from Alpaca dashboard' },
    {
      id: 'apiSecret',
      label: 'API Secret',
      secret: true,
      description: 'APCA-API-SECRET-KEY from Alpaca dashboard',
    },
  ],
  defaults: {
    orderType: 'market',
    timeInForce: 'day',
  },
  buildOrderRequest: (params) => {
    if (!params.apiKey || !params.apiSecret) {
      throw new Error('Alpaca API key and secret are required')
    }

    const baseUrl =
      params.environment === 'paper'
        ? 'https://paper-api.alpaca.markets'
        : 'https://api.alpaca.markets'

    const body: Record<string, any> = {
      symbol: params.symbol,
      qty: String(params.quantity),
      side: params.side,
      type: (params.orderType || 'market').toLowerCase(),
      time_in_force: params.timeInForce || 'day',
    }

    // Only include limit/stop prices for supported order types
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
        'APCA-API-KEY-ID': params.apiKey,
        'APCA-API-SECRET-KEY': params.apiSecret,
        'Content-Type': 'application/json',
      },
      body,
    }
  },
  buildHoldingsRequest: (params) => {
    if (!params.apiKey || !params.apiSecret) {
      throw new Error('Alpaca API key and secret are required')
    }

    const baseUrl =
      params.environment === 'paper'
        ? 'https://paper-api.alpaca.markets'
        : 'https://api.alpaca.markets'

    return {
      url: `${baseUrl}/v2/positions`,
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': params.apiKey,
        'APCA-API-SECRET-KEY': params.apiSecret,
      },
    }
  },
  normalizeOrder: (data: any) => ({
    id: data?.id,
    status: data?.status,
    submittedAt: data?.submitted_at,
    filledQty: data?.filled_qty ? Number(data.filled_qty) : undefined,
    symbol: data?.symbol,
    side: data?.side,
    raw: data,
  }),
  normalizeHoldings: (data: any) => {
    const positions = Array.isArray(data) ? data : data?.positions || data
    if (!Array.isArray(positions)) return []
    return positions.map((p: any) => ({
      symbol: p?.symbol,
      quantity: p?.qty ? Number(p.qty) : Number(p.quantity) || 0,
      avgPrice: p?.avg_entry_price ? Number(p.avg_entry_price) : undefined,
      marketValue: p?.market_value ? Number(p.market_value) : undefined,
      raw: p,
    }))
  },
}
