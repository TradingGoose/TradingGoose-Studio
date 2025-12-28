import { DollarIcon } from '@/components/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { getProviderFields, getTradingProviders } from '@/trading_providers'
import type { TradingActionResponse } from '@/tools/trading/types'

const providerOptions = getTradingProviders().map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

const providerFieldBlocks = (): SubBlockConfig[] => {
  const providers = getTradingProviders()
  return providers.flatMap((provider) =>
    (provider.fields || []).map((field) => ({
      id: field.id,
      title: field.label,
      type: field.type === 'dropdown' ? 'dropdown' : 'short-input',
      layout: 'full',
      required: field.required,
      placeholder: field.placeholder,
      description: field.description,
      options: field.options?.map((option) => ({ label: option.label, id: option.id })),
      condition: { field: 'provider', value: provider.id },
      canonicalParamId: field.id,
    }))
  )
}

export const TradingActionBlock: BlockConfig<TradingActionResponse> = {
  type: 'trading_action',
  name: 'Trading Action',
  description: 'Place buy/sell orders via Alpaca, Tradier, or Robinhood.',
  authMode: AuthMode.OAuth,
  longDescription:
    'Unified trading action block that supports multiple brokerages with either OAuth or API-key authentication.',
  category: 'tools',
  bgColor: '#ff766e',
  icon: DollarIcon,
  subBlocks: [
    {
      id: 'provider',
      title: 'Broker',
      type: 'dropdown',
      layout: 'full',
      options: providerOptions,
      required: true,
      value: () => 'alpaca',
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Paper (Sandbox)', id: 'paper' },
        { label: 'Live Trading', id: 'live' },
      ],
      condition: { field: 'provider', value: 'alpaca' },
      placeholder: 'Select environment',
      required: false,
    },
    // OAuth credential (Tradier)
    {
      id: 'tradierCredential',
      title: 'Tradier Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
      provider: 'tradier',
      serviceId: 'tradier',
      requiredScopes: ['read', 'write', 'trade'],
      placeholder: 'Select or connect Tradier account',
      condition: { field: 'provider', value: 'tradier' },
      canonicalParamId: 'credential',
    },
    // OAuth credential (Robinhood)
    {
      id: 'robinhoodCredential',
      title: 'Robinhood Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
      provider: 'robinhood',
      serviceId: 'robinhood',
      requiredScopes: ['internal', 'read', 'trading'],
      placeholder: 'Select or connect Robinhood account',
      condition: { field: 'provider', value: 'robinhood' },
      canonicalParamId: 'credential',
    },
    // OAuth credential (Alpaca)
    {
      id: 'alpacaCredential',
      title: 'Alpaca Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
      provider: 'alpaca',
      serviceId: 'alpaca',
      requiredScopes: ['account:write', 'trading', 'data'],
      placeholder: 'Select Alpaca account',
      condition: { field: 'provider', value: 'alpaca' },
      canonicalParamId: 'credential',
    },

    // API key auth (Alpaca)
    // {
    //   id: 'apiKey',
    //   title: 'API Key',
    //   type: 'short-input',
    //   layout: 'half',
    //   placeholder: 'APCA-API-KEY-ID',
    //   condition: { field: 'provider', value: 'alpaca' },
    //   required: true,
    // },
    // {
    //   id: 'apiSecret',
    //   title: 'API Secret',
    //   type: 'short-input',
    //   layout: 'half',
    //   placeholder: 'APCA-API-SECRET-KEY',
    //   condition: { field: 'provider', value: 'alpaca' },
    //   required: true,
    //   password: true,
    // },
    {
      id: 'side',
      title: 'Action',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Buy', id: 'buy' },
        { label: 'Sell', id: 'sell' },
      ],
      required: true,
    },
    {
      id: 'symbol',
      title: 'Symbol',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., AAPL',
      required: true,
    },
    {
      id: 'quantity',
      title: 'Quantity',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Number of shares',
      required: true,
    },
    {
      id: 'orderType',
      title: 'Order Type',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Market', id: 'market' },
        { label: 'Limit', id: 'limit' },
        { label: 'Stop', id: 'stop' },
        { label: 'Stop Limit', id: 'stop_limit' },
      ],
      required: true,
      value: () => 'market',
    },
    {
      id: 'limitPrice',
      title: 'Limit Price',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Required for limit orders',
      condition: { field: 'orderType', value: ['limit', 'stop_limit'] },
    },
    {
      id: 'stopPrice',
      title: 'Stop Price',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Required for stop/stop-limit orders',
      condition: { field: 'orderType', value: ['stop', 'stop_limit'] },
    },
    {
      id: 'timeInForce',
      title: 'Time in Force',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Day', id: 'day' },
        { label: 'Good Till Cancelled', id: 'gtc' },
        { label: 'Good For Day (GFD)', id: 'gfd' },
        { label: 'Immediate Or Cancel', id: 'ioc' },
        { label: 'Fill Or Kill', id: 'fok' },
      ],
      placeholder: 'Defaults vary by provider',
    },
    ...providerFieldBlocks(),
  ],
  tools: {
    access: ['trading_place_order'],
    config: {
      tool: () => 'trading_place_order',
      params: (params) => {
        const provider = params.provider
        const credential =
          params.credential || params.tradierCredential || params.robinhoodCredential || params.alpacaCredential
        const extraFields = getProviderFields(provider, 'order').reduce((acc, field) => {
          const key = `${provider}_${field.id}`
          if (params[key] !== undefined) {
            acc[field.id] = params[key]
          }
          return acc
        }, {} as Record<string, any>)

        return {
          provider,
          credential,
          environment: params.environment,
          side: params.side,
          symbol: params.symbol,
          quantity: params.quantity !== undefined ? Number(params.quantity) : params.quantity,
          orderType: params.orderType,
          limitPrice: params.limitPrice !== undefined ? Number(params.limitPrice) : undefined,
          stopPrice: params.stopPrice !== undefined ? Number(params.stopPrice) : undefined,
          timeInForce: params.timeInForce,
          ...extraFields,
        }
      },
    },
  },
  inputs: {
    provider: { type: 'string', description: 'Selected trading provider' },
    credential: { type: 'string', description: 'OAuth credential identifier' },
    environment: { type: 'string', description: 'Paper or live environment' },
    side: { type: 'string', description: 'buy or sell' },
    symbol: { type: 'string', description: 'Ticker symbol' },
    quantity: { type: 'number', description: 'Share quantity' },
    orderType: { type: 'string', description: 'Order type' },
    timeInForce: { type: 'string', description: 'Time in force' },
    limitPrice: { type: 'number', description: 'Limit price for applicable orders' },
    stopPrice: { type: 'number', description: 'Stop price for applicable orders' },
    accountId: { type: 'string', description: 'Provider-specific account identifier' },
    accountUrl: { type: 'string', description: 'Account resource URL (Robinhood)' },
    instrumentUrl: { type: 'string', description: 'Instrument resource URL (Robinhood orders)' },
  },
  outputs: {
    summary: { type: 'string', description: 'Order submission status' },
    provider: { type: 'string', description: 'Provider used' },
    order: { type: 'json', description: 'Order payload and raw response' },
  },
}
