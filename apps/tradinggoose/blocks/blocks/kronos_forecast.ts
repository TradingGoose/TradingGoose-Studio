import { ChartBarIcon } from '@/components/icons/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { MarketSeriesOutput } from '@/tools/market_data'
import type { ToolResponse } from '@/tools/types'
import {
  LISTING_IDENTITY_VALUE_TYPE,
  parseListingIdentityValueStrict,
} from '@/lib/listing/identity'
import { kronosForecastTool } from '@/tools/kronos'
import type { ForecastResponse } from '@/lib/kronos/types'

interface KronosForecastResponse extends ToolResponse {
  output: ForecastResponse
}

const MAX_HORIZON = 32
const MIN_HORIZON = 1

export const KronosForecastBlock: BlockConfig<KronosForecastResponse> = {
  type: 'kronos_forecast',
  name: 'Kronos Forecast',
  description: 'Generate a Kronos financial market forecast.',
  longDescription:
    'Feed historical market series into the Kronos foundation model and return a forecast for the next bars. This block does not place orders or access broker credentials.',
  category: 'tools',
  authMode: AuthMode.ApiKey,
  bgColor: '#7c3aed',
  icon: ChartBarIcon,
  subBlocks: [
    {
      id: 'listing',
      title: 'Listing',
      type: 'market-selector',
      layout: 'full',
      providerType: 'market',
      required: true,
    },
    {
      id: 'marketSeries',
      title: 'Market Series',
      type: 'code',
      layout: 'full',
      language: 'json',
      required: true,
      placeholder: 'Paste the output of the Historical Data block.',
      description: 'Normalized market series payload from the Historical Data block.',
    },
    {
      id: 'interval',
      title: 'Interval',
      type: 'short-input',
      layout: 'half',
      required: true,
      placeholder: 'e.g. 5m, 1h, 1d',
    },
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      layout: 'half',
      required: true,
      placeholder: 'e.g. America/New_York',
    },
    {
      id: 'normalizationMode',
      title: 'Normalization',
      type: 'short-input',
      layout: 'half',
      required: false,
      placeholder: 'raw',
    },
    {
      id: 'horizonBars',
      title: 'Horizon (bars)',
      type: 'short-input',
      layout: 'half',
      inputType: 'number',
      required: true,
      placeholder: '12',
      min: MIN_HORIZON,
      max: MAX_HORIZON,
      integer: true,
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'short-input',
      layout: 'half',
      inputType: 'number',
      required: false,
      placeholder: '1.0',
    },
    {
      id: 'topP',
      title: 'Top P',
      type: 'short-input',
      layout: 'half',
      inputType: 'number',
      required: false,
      placeholder: '0.9',
    },
  ],
  tools: {
    access: ['kronos_forecast'],
    config: {
      tool: () => 'kronos_forecast',
      params: (params) => {
        const marketSeries =
          typeof params.marketSeries === 'string'
            ? (JSON.parse(params.marketSeries) as MarketSeriesOutput)
            : (params.marketSeries as MarketSeriesOutput)

        return {
          listing: parseListingIdentityValueStrict(params.listing),
          marketSeries,
          interval: params.interval,
          timezone: params.timezone,
          normalizationMode: params.normalizationMode,
          horizonBars: Number(params.horizonBars),
          parameters: {
            temperature: params.temperature ? Number(params.temperature) : undefined,
            topP: params.topP ? Number(params.topP) : undefined,
          },
        }
      },
    },
  },
  inputs: {
    listing: {
      type: LISTING_IDENTITY_VALUE_TYPE,
      description: 'Canonical listing payload.',
    },
    marketSeries: { type: 'json', description: 'Normalized market series payload.' },
    interval: { type: 'string', description: 'Series interval/timeframe.' },
    timezone: { type: 'string', description: 'IANA timezone for the listing.' },
    normalizationMode: { type: 'string', description: 'Optional normalization mode.' },
    horizonBars: { type: 'number', description: 'Number of future bars to forecast.' },
    temperature: { type: 'number', description: 'Optional sampling temperature.' },
    topP: { type: 'number', description: 'Optional nucleus sampling probability.' },
  },
  outputs: {
    forecast: { type: 'json', description: 'Forecasted OHLCV points.' },
    model: { type: 'json', description: 'Model provenance metadata.' },
    diagnostics: { type: 'json', description: 'Forecast diagnostics and warnings.' },
    timingMs: { type: 'json', description: 'Request timing in milliseconds.' },
  },
}
