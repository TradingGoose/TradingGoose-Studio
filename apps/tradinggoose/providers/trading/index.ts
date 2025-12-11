import { createLogger } from '@/lib/logs/console/logger'
import type {
  TradingFieldDefinition,
  TradingProviderDefinition,
  TradingProviderId,
  TradingRequestConfig,
} from '@/providers/trading/types'

const logger = createLogger('TradingProviders')

const alpacaProvider: TradingProviderDefinition = {
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

const tradierProvider: TradingProviderDefinition = {
  id: 'tradier',
  name: 'Tradier',
  description: 'Retail trading via Tradier Brokerage.',
  authType: 'oauth',
  oauth: {
    provider: 'tradier',
    scopes: ['read', 'write', 'trade'],
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

const robinhoodProvider: TradingProviderDefinition = {
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

export const tradingProviders: Record<TradingProviderId, TradingProviderDefinition> = {
  alpaca: alpacaProvider,
  tradier: tradierProvider,
  robinhood: robinhoodProvider,
}

export const getTradingProviders = (): TradingProviderDefinition[] =>
  Object.values(tradingProviders)

export const getTradingProvider = (id: TradingProviderId): TradingProviderDefinition => {
  const provider = tradingProviders[id]
  if (!provider) {
    logger.error(`Trading provider not found: ${id}`)
    throw new Error(`Trading provider not found: ${id}`)
  }
  return provider
}

export const getProviderFields = (
  providerId: TradingProviderId,
  forOperation: 'order' | 'holdings'
): TradingFieldDefinition[] => {
  const provider = getTradingProvider(providerId)
  return (provider.fields || []).filter(
    (field) => field.for === forOperation || field.for === 'both'
  )
}
