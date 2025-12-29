import type { TradingProviderDefinition } from '@/trading_providers/types'

export const tradierProvider: TradingProviderDefinition = {
  id: 'tradier',
  name: 'Tradier',
  description: 'Retail trading via Tradier Brokerage.',
  authType: 'oauth',
  oauth: {
    provider: 'tradier',
    serviceId: 'tradier',
    scopes: ['read', 'write', 'trade'],
    credentialTitle: 'Tradier Account',
    credentialPlaceholder: 'Select or connect Tradier account',
  },
  fields: [
    {
      id: 'accountId',
      label: 'Tradier Account ID',
      type: 'string',
      for: 'both',
      required: true,
      description: 'Account number used in Tradier endpoints.',
    },
  ],
  defaults: {
    orderType: 'market',
    timeInForce: 'day',
  },
  buildOrderRequest: (params) => {
    if (!params.accessToken) {
      throw new Error('Tradier access token is required')
    }
    if (!params.accountId) {
      throw new Error('Tradier account ID is required')
    }

    const bodyParams = new URLSearchParams({
      class: 'equity',
      symbol: params.symbol,
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
  },
  buildHoldingsRequest: (params) => {
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
  },
  normalizeOrder: (data: any) => {
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
  },
  normalizeHoldings: (data: any) => {
    const positions = data?.positions?.position || data?.position || []
    const list = Array.isArray(positions) ? positions : [positions].filter(Boolean)
    return list.map((p: any) => ({
      symbol: p?.symbol,
      quantity: p?.quantity ? Number(p.quantity) : 0,
      avgPrice: p?.cost_basis ? Number(p.cost_basis) : undefined,
      marketValue: p?.market_value ? Number(p.market_value) : undefined,
      raw: p,
    }))
  },
}
