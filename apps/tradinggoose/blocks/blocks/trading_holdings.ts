import { DollarIcon } from '@/components/icons/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { buildInputsFromToolParams } from '@/blocks/utils'
import { getTradingProviders } from '@/providers/trading'
import { tradingHoldingsTool } from '@/tools/trading'
import type { TradingHoldingsResponse } from '@/tools/trading/types'

const providerOptions = getTradingProviders().map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

const providerCredentialBlocks = (): SubBlockConfig[] => {
  const providers = getTradingProviders()
  return providers
    .filter((provider) => provider.authType === 'oauth' && provider.oauth)
    .map((provider) => {
      const oauth = provider.oauth!
      const serviceIds = oauth.credentialServices?.map((service) => service.serviceId) ?? []
      return {
        id: `${provider.id}Credential`,
        title: oauth.credentialTitle || `${provider.name} Account`,
        type: 'oauth-input',
        layout: 'full',
        required: true,
        provider: oauth.provider,
        ...(serviceIds.length === 1 ? { serviceId: serviceIds[0] } : { serviceIds }),
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
  description: 'Fetch canonical portfolio detail from supported brokers.',
  authMode: AuthMode.OAuth,
  longDescription: 'Trading holdings block that returns canonical portfolio detail for Alpaca or Tradier.',
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
    ...providerCredentialBlocks(),
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
        return {
          provider,
          credential,
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
    holdings: { type: 'json', description: 'Canonical portfolio detail payload' },
  },
}
