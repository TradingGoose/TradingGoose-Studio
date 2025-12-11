import { DollarIcon } from '@/components/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { getProviderFields, getTradingProviders } from '@/providers/trading'
import type { TradingHoldingsResponse } from '@/tools/trading/types'

const providerOptions = getTradingProviders().map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

const providerFieldBlocks = (): SubBlockConfig[] => {
  const providers = getTradingProviders()
  return providers.flatMap((provider) =>
    (provider.fields || [])
      .filter((field) => field.for === 'holdings' || field.for === 'both')
      .map((field) => ({
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

export const TradingHoldingsBlock: BlockConfig<TradingHoldingsResponse> = {
  type: 'trading_holdings',
  name: 'Trading Holdings',
  description: 'Fetch account holdings/positions from supported brokers.',
  authMode: AuthMode.OAuth,
  longDescription:
    'Unified holdings block that returns the current positions for Alpaca, Tradier, or Robinhood.',
  category: 'tools',
  bgColor: '#115e59',
  icon: DollarIcon,
  subBlocks: [
    {
      id: 'provider',
      title: 'Broker',
      type: 'dropdown',
      layout: 'full',
      options: providerOptions,
      required: true,
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
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'half',
      placeholder: 'APCA-API-KEY-ID',
      condition: { field: 'provider', value: 'alpaca' },
      required: true,
    },
    {
      id: 'apiSecret',
      title: 'API Secret',
      type: 'short-input',
      layout: 'half',
      placeholder: 'APCA-API-SECRET-KEY',
      condition: { field: 'provider', value: 'alpaca' },
      required: true,
      password: true,
    },
    ...providerFieldBlocks(),
  ],
  tools: {
    access: ['trading_get_holdings'],
    config: {
      tool: () => 'trading_get_holdings',
      params: (params) => {
        const provider = params.provider
        const credential =
          params.credential || params.tradierCredential || params.robinhoodCredential
        const extraFields = getProviderFields(provider, 'holdings').reduce((acc, field) => {
          const key = `${provider}_${field.id}`
          if (params[key] !== undefined) {
            acc[field.id] = params[key]
          }
          return acc
        }, {} as Record<string, any>)

        return {
          provider,
          credential,
          apiKey: params.apiKey,
          apiSecret: params.apiSecret,
          environment: params.environment,
          ...extraFields,
        }
      },
    },
  },
  inputs: {
    provider: { type: 'string', description: 'Selected trading provider' },
    credential: { type: 'string', description: 'OAuth credential identifier' },
    apiKey: { type: 'string', description: 'API key for API-key providers' },
    apiSecret: { type: 'string', description: 'API secret for API-key providers' },
    environment: { type: 'string', description: 'Paper or live environment' },
    accountId: { type: 'string', description: 'Provider-specific account identifier' },
    accountUrl: { type: 'string', description: 'Account resource URL (Robinhood)' },
  },
  outputs: {
    summary: { type: 'string', description: 'Status of holdings retrieval' },
    provider: { type: 'string', description: 'Provider used' },
    holdings: { type: 'json', description: 'Holdings payload and raw response' },
  },
}
