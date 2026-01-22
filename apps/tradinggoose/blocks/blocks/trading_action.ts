import { DollarIcon } from '@/components/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { buildInputsFromToolParams } from '@/blocks/utils'
import {
  getProviderFields,
  getTradingProviderIdsForParam,
  getTradingProviders,
} from '@/providers/trading'
import { tradingActionTool } from '@/tools/trading'
import type { TradingActionResponse } from '@/tools/trading/types'

const providerOptions = getTradingProviders().map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

const providersWithEnvironment = getTradingProviderIdsForParam('order', 'environment')

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

const providerCredentialBlocks = (): SubBlockConfig[] => {
  const providers = getTradingProviders()
  return providers
    .filter((provider) => provider.authType === 'oauth' && provider.oauth)
    .map((provider) => {
      const oauth = provider.oauth!
      return {
        id: `${provider.id}Credential`,
        title: oauth.credentialTitle || `${provider.name} Account`,
        type: 'oauth-input',
        layout: 'full',
        required: true,
        provider: oauth.provider,
        serviceId: oauth.serviceId || oauth.provider,
        requiredScopes: oauth.scopes || [],
        placeholder: oauth.credentialPlaceholder || `Select or connect ${provider.name} account`,
        condition: { field: 'provider', value: provider.id },
        canonicalParamId: 'credential',
      }
    })
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
      condition: providersWithEnvironment.length
        ? { field: 'provider', value: providersWithEnvironment }
        : undefined,
      hidden: providersWithEnvironment.length === 0,
      placeholder: 'Select environment',
      required: false,
    },

    ...providerCredentialBlocks(),
    
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
      id: 'listing',
      title: 'Listing',
      type: 'market-selector',
      layout: 'full',
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
        const resolveCredential = () => {
          if (params.credential) return params.credential
          if (provider) {
            const providerKey = `${provider}Credential`
            if (params[providerKey] !== undefined) return params[providerKey]
          }
          return getTradingProviders()
            .map((definition) => params[`${definition.id}Credential`])
            .find((value) => value !== undefined)
        }
        const credential = resolveCredential()
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
          listing: params.listing,
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
  inputs: buildInputsFromToolParams(tradingActionTool.params, {
    include: ['credential'], // include hidden credential to allow wiring while keeping accessToken hidden
  }),
  outputs: {
    summary: { type: 'string', description: 'Order submission status' },
    provider: { type: 'string', description: 'Provider used' },
    order: { type: 'json', description: 'Order payload and raw response' },
  },
}
