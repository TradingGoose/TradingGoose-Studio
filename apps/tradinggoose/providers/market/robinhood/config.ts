import type { MarketProviderConfig } from '@/providers/market/providers'
import type { MarketInterval } from '@/providers/market/types'

// Fixed intervals exposed by Robinhood's get_equity_historicals tool.
// Discovery reference: github.com/alphillips-lab/robinhoodmcp/blob/main/src/robinhoodmcp/client.py
export const ROBINHOOD_INTERVALS = {
  '1m': 'minute',
  '5m': '5minute',
  '10m': '10minute',
  '30m': '30minute',
  '1h': 'hour',
  '4h': '4hour',
  '1d': 'day',
  '1w': 'week',
  '1mo': 'month',
  '3mo': '3month',
  '6mo': '6month',
  '12mo': 'year',
} satisfies Partial<Record<MarketInterval, string>>

export const robinhoodProviderConfig: MarketProviderConfig = {
  id: 'robinhood',
  name: 'Robinhood',
  utcOffset: 0,
  availability: {
    assetClass: ['stock', 'etf'],
    availableListingQuote: ['USD'],
    series: true,
    live: true,
  },
  params: {
    shared: [
      {
        id: 'credentialId',
        type: 'string',
        title: 'Robinhood connection',
        description: 'Your connected Robinhood account.',
        required: true,
        visibility: 'user-only',
      },
    ],
  },
  capabilities: {
    series: {
      supportsInterval: true,
      intervals: Object.keys(ROBINHOOD_INTERVALS) as MarketInterval[],
      windowModes: ['bars', 'range', 'absolute'],
      normalizationModes: ['raw', 'split_adjusted'],
      marketSessions: ['regular', 'extended'],
    },
    live: { channels: ['bars'], pollingIntervalMs: 30_000 },
  },
  rulePrecedence: { default: ['market', 'currency', 'assetClass', 'listing'] },
  exchangeCodeToMarket: {},
  marketToExchangeCode: {},
  exchangeCodes: [],
  rules: [{ template: '{base}', active: true }],
}
