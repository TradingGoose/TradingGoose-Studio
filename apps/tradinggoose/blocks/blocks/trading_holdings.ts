import { DollarIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { requiredUserOnlyInput } from '@/blocks/utils'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import type { TradingHoldingsResponse } from '@/providers/trading/types'

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
      type: 'trading-provider-selector',
      layout: 'full',
      tradingProviderKind: 'holdings',
      placeholder: 'Select broker',
      required: true,
    },
    {
      id: 'portfolioIdentity',
      title: 'Broker Account',
      type: 'trading-account-selector',
      layout: 'full',
      required: true,
      dependsOn: ['provider'],
      autoSelectFirstOption: false,
      placeholder: 'Select broker account',
      description: 'Broker account used to fetch canonical portfolio detail.',
      tradingProviderFieldId: 'provider',
    },
  ],
  tools: {
    access: ['trading_get_holdings'],
    config: {
      tool: () => 'trading_get_holdings',
      params: (params) => {
        const portfolioIdentity = toPortfolioValueObject(params.portfolioIdentity)
        return {
          portfolioIdentity,
        }
      },
    },
  },
  inputs: {
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
