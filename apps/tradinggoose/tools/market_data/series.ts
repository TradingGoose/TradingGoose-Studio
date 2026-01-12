import { createLogger } from '@/lib/logs/console/logger'
import {
  coerceMarketProviderParamValue,
  getMarketProviderParamCatalog,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'
import {
  resolveListingKey,
  toListingValueObject,
  type ListingIdentity,
} from '@/lib/market/listings'
import type { MarketSeries, NormalizationMode } from '@/providers/market/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface MarketSeriesParams {
  provider: string
  listing: ListingIdentity
  interval?: string
  start: string | number
  end: string | number
  normalizationMode?: string
  apiKey?: string
  apiSecret?: string
  providerParams?: Record<string, any> | string
}

export type MarketSeriesOutput = MarketSeries

const logger = createLogger('MarketSeriesTool')

const RESERVED_PARAM_IDS = new Set([
  'provider',
  'listing',
  'interval',
  'start',
  'end',
  'normalizationMode',
  'providerParams',
])

const providerParamCatalog = getMarketProviderParamCatalog('series')
const providerParamRegistry = providerParamCatalog.registry
const providerParamIds = providerParamCatalog.order.filter((id) => !RESERVED_PARAM_IDS.has(id))

const buildToolParams = (): ToolConfig['params'] => {
  const params: ToolConfig['params'] = {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Market data provider id (e.g., alpaca, finnhub, yahoo-finance).',
    },
    listing: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Structured listing payload from TradingGoose Market.',
    },
  }

  providerParamIds.forEach((paramId) => {
    const entry = providerParamRegistry[paramId]
    if (!entry || params[paramId]) return
    const definition = entry.definition

    params[paramId] = {
      type: definition.type,
      required: definition.required,
      visibility: definition.visibility ?? 'user-only',
      description: definition.description,
      default: definition.defaultValue,
    }
  })

  params.interval = {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Series interval/timeframe supported by the provider.',
  }

  params.normalizationMode = {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Normalization mode supported by the provider (optional).',
  }

  params.start = {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Start of the interval (ISO date string or UNIX timestamp).',
  }

  params.end = {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'End of the interval (ISO date string or UNIX timestamp).',
  }

  params.providerParams = {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional provider-specific parameters.',
  }

  return params
}

const parseProviderParams = (value: unknown): Record<string, any> => {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      throw new Error('providerParams must be valid JSON')
    }
  }
  if (typeof value === 'object') return value as Record<string, any>
  return {}
}

const sanitizeInterval = (provider: string, interval?: string): string | undefined => {
  if (!interval) return undefined
  const capabilities = getMarketSeriesCapabilities(provider)
  if (!capabilities) return interval
  if (capabilities.supportsInterval === false) return undefined
  const intervals = capabilities.intervals ?? []
  if (intervals.length > 0 && !intervals.includes(interval)) return undefined
  return interval
}

const sanitizeNormalizationMode = (
  provider: string,
  mode?: string
): NormalizationMode | undefined => {
  if (!mode) return undefined
  const capabilities = getMarketSeriesCapabilities(provider)
  if (!capabilities || !('normalizationModes' in capabilities)) return mode as NormalizationMode
  const modes = capabilities.normalizationModes ?? []
  if (modes.length === 0) return undefined
  if (!modes.includes(mode as NormalizationMode)) return undefined
  return mode as NormalizationMode
}

export const historicalDataTool: ToolConfig<MarketSeriesParams, ToolResponse> = {
  id: 'historical_data_fetch',
  name: 'Market Series Fetch',
  description: 'Fetch and normalize market series data from registered market providers.',
  version: '2.0.0',
  params: buildToolParams(),
  request: {
    url: '/api/providers',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: MarketSeriesParams) => {
      const rawParams = params as Record<string, any>
      const providerParams = parseProviderParams(rawParams.providerParams)
      const listing = toListingValueObject(params.listing)

      if (!listing) {
        throw new Error('listing is required')
      }

      providerParamIds.forEach((paramId) => {
        const entry = providerParamRegistry[paramId]
        if (!entry) return
        const value = coerceMarketProviderParamValue(entry.definition, rawParams[paramId])
        if (value !== undefined) {
          providerParams[paramId] = value
        }
      })

      const interval = sanitizeInterval(params.provider, params.interval)
      const normalizationMode = sanitizeNormalizationMode(params.provider, params.normalizationMode)

      if (interval === undefined && 'interval' in providerParams) {
        delete providerParams.interval
      }
      if (normalizationMode === undefined && 'normalizationMode' in providerParams) {
        delete providerParams.normalizationMode
      }

      return {
        provider: params.provider,
        providerNamespace: 'market',
        kind: 'series',
        listing,
        interval,
        start: params.start,
        end: params.end,
        normalizationMode,
        providerParams: Object.keys(providerParams).length ? providerParams : undefined,
      }
    },
  },
  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      return {
        success: false,
        output: data || {},
        error: (data as any)?.error || response.statusText,
      }
    }

    return {
      success: true,
      output: data,
    }
  },
  postProcess: async (result, params): Promise<ToolResponse> => {
    if (!result.success) return result

    try {
      const series = result.output as MarketSeries
      const bars = Array.isArray(series?.bars) ? series.bars : []
      if (!bars.length) {
        throw new Error('No data returned for the requested time range')
      }
      const listing = series.listing ?? toListingValueObject(params.listing)
      const seriesOutput = { ...series } as MarketSeries & { primaryMicCode?: string }
      if ('primaryMicCode' in seriesOutput) {
        delete seriesOutput.primaryMicCode
      }
      return { success: true, output: { ...seriesOutput, listing } }
    } catch (error: any) {
      logger.error('Error validating market series data', {
        provider: params.provider,
        listing: resolveListingKey(params.listing),
        error: error?.message || error,
      })
      return {
        success: false,
        output: result.output as any,
        error: error?.message || 'Failed to normalize market series data',
      }
    }
  },
  outputs: {
    listingBase: { type: 'string', description: 'Listing base symbol', optional: true },
    listingQuote: { type: 'string', description: 'Listing quote currency', optional: true },
    listing: {
      type: 'object',
      description: 'Structured listing identifier payload',
      properties: {
        equity_id: { type: 'string', description: 'Equity listing id', optional: true },
        base_id: { type: 'string', description: 'Base asset id', optional: true },
        quote_id: { type: 'string', description: 'Quote asset id', optional: true },
        base_asset_class: { type: 'string', description: 'Base asset class', optional: true },
        quote_asset_class: { type: 'string', description: 'Quote asset class', optional: true },
      },
    },
    bars: {
      type: 'array',
      description: 'OHLCV bars with timestamps',
      items: {
        type: 'object',
        properties: {
          timeStamp: { type: 'string', description: 'Bar timestamp (ISO)' },
          open: { type: 'number', description: 'Open price', optional: true },
          high: { type: 'number', description: 'High price', optional: true },
          low: { type: 'number', description: 'Low price', optional: true },
          close: { type: 'number', description: 'Close price' },
          volume: { type: 'number', description: 'Volume', optional: true },
        },
      },
    },
    start: { type: 'string', description: 'Start of the returned series', optional: true },
    end: { type: 'string', description: 'End of the returned series', optional: true },
    timezone: { type: 'string', description: 'Exchange timezone for the series', optional: true },
    normalizationMode: { type: 'string', description: 'Normalization mode used', optional: true },
  },
}
