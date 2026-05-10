import { DollarIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { requiredUserOnlyInput } from '@/blocks/utils'
import { getTradingProvidersByKind } from '@/providers/trading'
import type { TradingHoldingsResponse } from '@/tools/trading/types'

const providerOptions = getTradingProvidersByKind('holdings').map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

export const TradingHoldingsBlock: BlockConfig<TradingHoldingsResponse> = {
  type: 'trading_holdings',
  name: 'Trading Holdings',
  description: 'Fetch canonical portfolio detail from supported brokers.',
  authMode: AuthMode.OAuth,
  longDescription:
    'Trading holdings block that returns canonical portfolio detail for Alpaca or Tradier.',
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
      id: 'portfolioIdentity',
      title: 'Broker Account',
      type: 'dropdown',
      layout: 'full',
      required: true,
      dependsOn: ['provider'],
      enableSearch: true,
      autoSelectFirstOption: false,
      placeholder: 'Select broker account',
      description: 'Broker account used to fetch canonical portfolio detail.',
      fetchOptions: async (_blockId, _subBlockId, context) => {
        const providerEntry = context.contextValues?.provider
        const provider =
          typeof providerEntry === 'string'
            ? providerEntry
            : providerEntry && typeof providerEntry === 'object' && 'value' in providerEntry
              ? String(providerEntry.value ?? '')
              : ''
        if (!provider) return []

        const response = await fetch(
          `/api/providers/trading/portfolio-identities?provider=${encodeURIComponent(provider)}`,
          { cache: 'no-store' }
        )
        if (!response.ok) return []

        const data = (await response.json()) as {
          options?: Array<{ label: string; id: string; value?: unknown; searchLabel?: string }>
        }
        return data.options ?? []
      },
    },
  ],
  tools: {
    access: ['trading_get_holdings'],
    config: {
      tool: () => 'trading_get_holdings',
      params: (params) => {
        return {
          provider: params.provider,
          portfolioIdentity: params.portfolioIdentity,
        }
      },
    },
  },
  inputs: {
    provider: requiredUserOnlyInput('string', 'Trading provider id (alpaca or tradier).'),
    portfolioIdentity: requiredUserOnlyInput(
      'json',
      'Canonical portfolioIdentity selected by the broker account field.'
    ),
  },
  outputs: {
    summary: { type: 'string', description: 'Status of holdings retrieval' },
    provider: { type: 'string', description: 'Provider used' },
    holdings: { type: 'json', description: 'Canonical portfolio detail payload' },
  },
}
