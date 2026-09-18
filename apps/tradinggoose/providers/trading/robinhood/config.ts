import type { TradingProviderConfig } from '@/providers/trading/providers'

export const ROBINHOOD_MCP_URL = 'https://agent.robinhood.com/mcp/trading'

export const robinhoodTradingProviderConfig: TradingProviderConfig = {
  id: 'robinhood',
  name: 'Robinhood',
  availability: {
    assetClass: ['stock', 'etf'],
    availableListingQuote: ['USD'],
    order: true,
    portfolioDetail: true,
  },
  capabilities: {
    order: {
      preview: true,
      sizingModes: [
        { id: 'quantity', label: 'Quantity (Shares)' },
        {
          id: 'notional',
          label: 'Dollar Amount (USD)',
          orderTypes: ['market'],
          timeInForce: ['day'],
        },
      ],
      orderTypes: [
        { id: 'market', label: 'Market' },
        { id: 'limit', label: 'Limit', requires: ['limitPrice'] },
        { id: 'stop', label: 'Stop', requires: ['stopPrice'] },
        { id: 'stop_limit', label: 'Stop Limit', requires: ['limitPrice', 'stopPrice'] },
      ],
      timeInForce: ['day', 'gtc'],
    },
    portfolioDetail: { performanceWindows: [] },
  },
  rulePrecedence: { default: ['currency', 'assetClass', 'country', 'listing'] },
  exchangeCodeToMarket: {},
  marketToExchangeCode: {},
  exchangeCodes: [],
  rules: [{ template: '{base}', active: true }],
}
