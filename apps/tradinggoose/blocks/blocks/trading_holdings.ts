import { DollarIcon } from '@/components/icons/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { buildInputsFromToolParams } from '@/blocks/utils'
import {
  getProviderFields,
  getTradingProviderIdsForParam,
  getTradingProviders,
} from '@/providers/trading'
import { tradingHoldingsTool } from '@/tools/trading'
import type { TradingHoldingsResponse } from '@/tools/trading/types'

const providerOptions = getTradingProviders().map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

const providersWithEnvironment = getTradingProviderIdsForParam('holdings', 'environment')

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

export const TradingHoldingsBlock: BlockConfig<TradingHoldingsResponse> = {
  type: 'trading_holdings',
  name: 'Trading Holdings',
  description: 'Fetch a unified account snapshot from supported brokers.',
  authMode: AuthMode.OAuth,
  longDescription:
    'Unified holdings block that returns an account snapshot for Alpaca, Tradier, or Robinhood.',
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
      condition: providersWithEnvironment.length
        ? { field: 'provider', value: providersWithEnvironment }
        : undefined,
      hidden: providersWithEnvironment.length === 0,
      placeholder: 'Select environment',
      required: false,
    },
    ...providerCredentialBlocks(),
    ...providerFieldBlocks(),
  ],
  tools: {
    access: ['trading_get_holdings'],
    config: {
      tool: () => 'trading_get_holdings',
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
          environment: params.environment,
          ...extraFields,
        }
      },
    },
  },
  inputs: buildInputsFromToolParams(tradingHoldingsTool.params, {
    include: ['credential'],
  }),
  outputs: {
    summary: { type: 'string', description: 'Status of holdings retrieval' },
    provider: { type: 'string', description: 'Provider used' },
    holdings: { type: 'json', description: 'Unified account snapshot payload' },
  },
}
