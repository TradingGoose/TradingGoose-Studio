import type { TradingProviderDefinition } from '@/trading_providers/types'

export const robinhoodProvider: TradingProviderDefinition = {
  id: 'robinhood',
  name: 'Robinhood',
  description: 'Robinhood brokerage (OAuth).',
  authType: 'oauth',
  oauth: {
    provider: 'robinhood',
    scopes: ['internal', 'read', 'trading'],
  },
  fields: [
    {
      id: 'accountUrl',
      label: 'Robinhood Account URL',
      type: 'string',
      for: 'both',
      required: false,
      description: 'Account resource URL (optional if default account is used).',
    },
    {
      id: 'instrumentUrl',
      label: 'Instrument URL',
      type: 'string',
      for: 'order',
      required: true,
      description:
        'Instrument resource URL for the symbol (can be retrieved via /instruments?symbol=SYMBOL).',
    },
  ],
  defaults: {
    orderType: 'market',
    timeInForce: 'gfd',
  },
  buildOrderRequest: (params) => {
    if (!params.accessToken) {
      throw new Error('Robinhood access token is required')
    }
    if (!params.instrumentUrl) {
      throw new Error('Instrument URL is required for Robinhood orders')
    }

    const body: Record<string, any> = {
      account: params.accountUrl,
      instrument: params.instrumentUrl,
      symbol: params.symbol,
      type: params.orderType || 'market',
      time_in_force: params.timeInForce || 'gfd',
      trigger: 'immediate',
      quantity: params.quantity,
      side: params.side,
      price: params.limitPrice,
    }

    if (body.type === 'market') {
      delete body.price
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
  },
  buildHoldingsRequest: (params) => {
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
  },
  normalizeOrder: (data: any) => ({
    id: data?.id,
    status: data?.state,
    submittedAt: data?.created_at,
    filledQty: data?.quantity ? Number(data.quantity) : undefined,
    symbol: data?.symbol,
    side: data?.side,
    raw: data,
  }),
  normalizeHoldings: (data: any) => {
    const positions = data?.results || []
    return positions.map((p: any) => ({
      symbol: p?.symbol,
      quantity: p?.quantity ? Number(p.quantity) : 0,
      avgPrice: p?.average_buy_price ? Number(p.average_buy_price) : undefined,
      marketValue: p?.market_value ? Number(p.market_value) : undefined,
      raw: p,
    }))
  },
}
