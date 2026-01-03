import { createLogger } from '@/lib/logs/console/logger'
import {
  coerceMarketProviderParamValue,
  getMarketProviderParamCatalog,
} from '@/providers/market/providers'
import type { MarketSeries, NormalizationMode } from '@/providers/market/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface MarketSeriesParams {
  provider: string
  listingId: string
  interval?: string
  start: string | number
  end: string | number
  normalizationMode?: NormalizationMode
  apiKey?: string
  apiSecret?: string
  providerParams?: Record<string, any> | string
}

export interface MarketSeriesOutput {
  listingId: string
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  date: string[]
  volume: number[]
  timezone?: string
  normalizationMode?: NormalizationMode
}

const logger = createLogger('MarketSeriesTool')

const RESERVED_PARAM_IDS = new Set([
  'provider',
  'listingId',
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
    listingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Canonical listing id from TradingGoose Market.',
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

const normalizeSeries = (series: MarketSeries): MarketSeriesOutput => {
  const bars = Array.isArray(series?.bars) ? series.bars : []
  if (!bars.length) {
    throw new Error('No data returned for the requested time range')
  }

  const open: number[] = []
  const high: number[] = []
  const low: number[] = []
  const close: number[] = []
  const volume: number[] = []
  const date: string[] = []

  bars.forEach((bar) => {
    if (!bar) return
    if (!bar.timeStamp) return
    if (bar.close == null) return

    open.push(Number(bar.open ?? 0))
    high.push(Number(bar.high ?? 0))
    low.push(Number(bar.low ?? 0))
    close.push(Number(bar.close))
    volume.push(Number(bar.volume ?? 0))
    date.push(bar.timeStamp)
  })

  if (!date.length) {
    throw new Error('No valid bars returned for the requested time range')
  }

  return {
    listingId: series.listingId,
    open,
    high,
    low,
    close,
    date,
    volume,
    timezone: series.timezone,
    normalizationMode: series.normalizationMode,
  }
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

      providerParamIds.forEach((paramId) => {
        const entry = providerParamRegistry[paramId]
        if (!entry) return
        const value = coerceMarketProviderParamValue(entry.definition, rawParams[paramId])
        if (value !== undefined) {
          providerParams[paramId] = value
        }
      })

      return {
        provider: params.provider,
        providerNamespace: 'market',
        kind: 'series',
        listingId: params.listingId,
        interval: params.interval,
        start: params.start,
        end: params.end,
        normalizationMode: params.normalizationMode,
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
      const normalized = normalizeSeries(result.output as MarketSeries)
      return { success: true, output: normalized }
    } catch (error: any) {
      logger.error('Error normalizing market series data', {
        provider: params.provider,
        listingId: params.listingId,
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
    listingId: { type: 'string', description: 'Listing id for the returned series' },
    open: { type: 'array', description: 'Open prices for each bar' },
    high: { type: 'array', description: 'High prices for each bar' },
    low: { type: 'array', description: 'Low prices for each bar' },
    close: { type: 'array', description: 'Close prices for each bar' },
    date: { type: 'array', description: 'ISO timestamps for each bar' },
    volume: { type: 'array', description: 'Volume for each bar' },
    timezone: { type: 'string', description: 'Exchange timezone for the series', optional: true },
    normalizationMode: { type: 'string', description: 'Normalization mode used', optional: true },
  },
}
