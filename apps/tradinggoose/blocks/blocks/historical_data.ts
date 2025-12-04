import { ChartBarIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { HistoricalDataOutput } from '@/tools/historical_data'
import type { ToolResponse } from '@/tools/types'

interface HistoricalDataResponse extends ToolResponse {
  output: HistoricalDataOutput
}

const providerOptions = [
  { label: 'Alpaca', id: 'alpaca' },
  { label: 'Yahoo Finance', id: 'yahoo_finance' },
  { label: 'Finnhub', id: 'finnhub' },
]

export const HistoricalDataBlock: BlockConfig<HistoricalDataResponse> = {
  type: 'historical_data',
  name: 'Historical Data',
  description: 'Fetch historical market data from your preferred provider.',
  longDescription:
    'Choose a market data provider, supply credentials when required, and fetch normalized candles that include open, high, low, close, volume, and timestamp arrays. Start and end can be ISO strings or UNIX timestamps.',
  category: 'tools',
  authMode: AuthMode.ApiKey,
  bgColor: '#0EA5E9',
  icon: ChartBarIcon,
  subBlocks: [
    {
      id: 'provider',
      title: 'Data Provider',
      type: 'dropdown',
      layout: 'full',
      options: providerOptions,
      value: () => providerOptions[0]?.id,
      required: true,
    },
    {
      id: 'alpaca_api_key_id',
      title: 'Alpaca API Key ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'APCA-API-KEY-ID header',
      condition: { field: 'provider', value: 'alpaca' },
    },
    {
      id: 'alpaca_api_secret_key',
      title: 'Alpaca Secret Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'APCA-API-SECRET-KEY header',
      password: true,
      condition: { field: 'provider', value: 'alpaca' },
    },
    {
      id: 'finnhub_api_key',
      title: 'Finnhub API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'X-Finnhub-Token header',
      password: true,
      condition: { field: 'provider', value: 'finnhub' },
    },
    {
      id: 'stock',
      title: 'Stock',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., AAPL',
      required: true,
    },
    {
      id: 'data_resolution',
      title: 'Data Resolution',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., 1Day, 1d, 60',
      required: true,
    },
    {
      id: 'start',
      title: 'Start',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Start time (ISO or UNIX)',
      required: true,
    },
    {
      id: 'end',
      title: 'End',
      type: 'short-input',
      layout: 'half',
      placeholder: 'End time (ISO or UNIX)',
      required: true,
    },
  ],
  tools: {
    access: ['historical_data_fetch'],
    config: {
      params: (params) => {
        const stock = (params.stock || '').trim()
        const provider = (params.provider || '').toLowerCase().replace(/\s+/g, '_')

        return {
          ...params,
          provider,
          stock: stock ? stock.toUpperCase() : stock,
          data_resolution: params.data_resolution?.trim(),
          alpaca_api_key_id: params.alpaca_api_key_id || undefined,
          alpaca_api_secret_key: params.alpaca_api_secret_key || undefined,
          finnhub_api_key: params.finnhub_api_key || undefined,
        }
      },
    },
  },
  inputs: {
    provider: { type: 'string', description: 'Data provider (alpaca, yahoo_finance, finnhub)' },
    data_resolution: {
      type: 'string',
      description:
        'Timeframe represented by each bar (maps to timeframe/interval/resolution depending on provider)',
    },
    stock: { type: 'string', description: 'Stock symbol' },
    start: { type: 'string', description: 'Inclusive start of the interval (ISO or UNIX timestamp)' },
    end: { type: 'string', description: 'Inclusive end of the interval (ISO or UNIX timestamp)' },
    alpaca_api_key_id: { type: 'string', description: 'Alpaca API key ID header value' },
    alpaca_api_secret_key: { type: 'string', description: 'Alpaca API secret header value' },
    finnhub_api_key: { type: 'string', description: 'Finnhub API key header value' },
  },
  outputs: {
    stock: { type: 'string', description: 'Stock symbol for the returned series' },
    close: { type: 'array', description: 'Close prices' },
    high: { type: 'array', description: 'High prices' },
    low: { type: 'array', description: 'Low prices' },
    open: { type: 'array', description: 'Open prices' },
    date: { type: 'array', description: 'ISO timestamps for each bar' },
    volume: { type: 'array', description: 'Volume for each bar' },
  },
}
