import { ChartBarIcon } from '@/components/icons/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { MarketSeriesOutput } from '@/tools/market_data'
import type { ToolResponse } from '@/tools/types'
import {
  coerceMarketProviderParamValue,
  getMarketProviderOptionsByKind,
  getMarketProviderParamCatalog,
  getMarketProvidersByKind,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'
import type { NormalizationMode } from '@/providers/market/types'

interface HistoricalDataResponse extends ToolResponse {
  output: MarketSeriesOutput
}

const providerOptions = () =>
  getMarketProviderOptionsByKind('series').map((provider) => ({
    label: provider.name,
    id: provider.id,
  }))

const resolveContextValue = (
  contextValues: Record<string, any> | undefined,
  key: string
): string | undefined => {
  const entry = contextValues?.[key]
  if (entry && typeof entry === 'object' && 'value' in entry) {
    return (entry as { value?: string }).value
  }
  if (typeof entry === 'string') return entry
  return undefined
}

const RESERVED_PARAM_IDS = new Set([
  'provider',
  'listing',
  'interval',
  'start',
  'end',
  'normalizationMode',
])

const providerParamCatalog = getMarketProviderParamCatalog('series')
const providerParamRegistry = providerParamCatalog.registry
const providerParamIds = providerParamCatalog.order.filter((id) => {
  if (RESERVED_PARAM_IDS.has(id)) return false
  const definition = providerParamRegistry[id]?.definition
  if (!definition) return false
  return definition.mode !== 'advanced'
})

const isSensitiveParam = (paramId: string): boolean => {
  const lowered = paramId.toLowerCase()
  return (
    lowered.includes('apikey') ||
    lowered.includes('api_key') ||
    lowered.includes('secret') ||
    lowered.includes('token') ||
    lowered.includes('password')
  )
}

const formatParamTitle = (paramId: string): string => {
  if (paramId === 'apiKey') return 'API Key'
  if (paramId === 'apiSecret') return 'API Secret'
  if (paramId === 'apiVersion') return 'API Version'

  if (paramId.includes('_') || paramId.includes('-')) {
    return paramId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  if (/[A-Z]/.test(paramId)) {
    const result = paramId.replace(/([A-Z])/g, ' $1')
    return (
      result.charAt(0).toUpperCase() +
      result
        .slice(1)
        .replace(/ Api/g, ' API')
        .replace(/ Id/g, ' ID')
        .replace(/ Url/g, ' URL')
        .replace(/ Uri/g, ' URI')
    )
  }

  return paramId.charAt(0).toUpperCase() + paramId.slice(1)
}

const formatIntervalLabel = (interval: string): string => {
  const match = interval.match(/^(\d+)(m|h|d|w|mo)$/)
  if (!match) return interval
  const value = Number(match[1])
  const unitCode = match[2]
  const unit =
    unitCode === 'm'
      ? 'minute'
      : unitCode === 'h'
        ? 'hour'
        : unitCode === 'd'
          ? 'day'
          : unitCode === 'w'
            ? 'week'
            : 'month'
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

const sanitizeInterval = (provider: string | undefined, interval?: string): string | undefined => {
  if (!interval) return undefined
  if (!provider) return interval
  const capabilities = getMarketSeriesCapabilities(provider)
  if (!capabilities) return interval
  if (capabilities.supportsInterval === false) return undefined
  const intervals = capabilities.intervals ?? []
  if (intervals.length > 0 && !intervals.includes(interval)) return undefined
  return interval
}

const sanitizeNormalizationMode = (
  provider: string | undefined,
  mode?: string
): NormalizationMode | undefined => {
  if (!mode) return undefined
  if (!provider) return mode as NormalizationMode
  const capabilities = getMarketSeriesCapabilities(provider)
  if (!capabilities || !('normalizationModes' in capabilities)) return mode as NormalizationMode
  const modes = capabilities.normalizationModes ?? []
  if (modes.length === 0) return undefined
  if (!modes.includes(mode as NormalizationMode)) return undefined
  return mode as NormalizationMode
}

const resolveParamInputType = (paramId: string): SubBlockConfig['type'] => {
  const definition = providerParamRegistry[paramId]?.definition
  if (!definition) return 'short-input'

  if (definition.inputType) return definition.inputType
  if (definition.options?.length) return 'dropdown'

  switch (definition.type) {
    case 'boolean':
      return 'switch'
    case 'json':
    case 'array':
      return 'code'
    case 'number':
      return 'short-input'
    default:
      return 'short-input'
  }
}

const buildProviderParamSubBlocks = (): SubBlockConfig[] =>
  providerParamIds
    .map((paramId) => {
      const entry = providerParamRegistry[paramId]
      if (!entry) return null

      const definition = entry.definition
      if (definition.mode === 'advanced') return null
      const inputType = resolveParamInputType(paramId)

      return {
        id: paramId,
        title: definition.title || formatParamTitle(paramId),
        type: inputType,
        layout: definition.layout || 'full',
        required: definition.required,
        placeholder: definition.placeholder || definition.description,
        password: definition.password ?? isSensitiveParam(paramId),
        options: definition.options,
        value: definition.defaultValue,
        fetchOptions: definition.fetchOptions,
        min: definition.min,
        max: definition.max,
        step: definition.step,
        integer: definition.integer,
        rows: definition.rows,
        dependsOn: definition.dependsOn,
        mode: definition.mode,
        condition: entry.providers.length
          ? { field: 'provider', value: entry.providers }
          : undefined,
        language:
          inputType === 'code' && (definition.type === 'json' || definition.type === 'array')
            ? 'json'
            : undefined,
      } as SubBlockConfig
    })
    .filter((block): block is SubBlockConfig => Boolean(block))

const providerParamSubBlocks = buildProviderParamSubBlocks()

const seriesProviders = getMarketProvidersByKind('series')

const providersWithIntervals = seriesProviders
  .filter((provider) => {
    const capabilities = getMarketSeriesCapabilities(provider.id)
    if (!capabilities) return false
    if (capabilities.supportsInterval === false) return false
    const intervals = capabilities.intervals ?? []
    return capabilities.supportsInterval ?? intervals.length > 0
  })
  .map((provider) => provider.id)

const providersWithNormalization = seriesProviders
  .filter((provider) => {
    const capabilities = getMarketSeriesCapabilities(provider.id)
    return Boolean(capabilities?.normalizationModes?.length)
  })
  .map((provider) => provider.id)

export const HistoricalDataBlock: BlockConfig<HistoricalDataResponse> = {
  type: 'historical_data',
  name: 'Historical Data',
  description: 'Fetch historical market series from registered providers.',
  longDescription:
    'Choose a market data provider, select a canonical listing, and fetch series bars that include open, high, low, close, volume, and timestamps. Start and end can be ISO strings or UNIX timestamps.',
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
      value: () => providerOptions()[0]?.id,
      required: true,
    },
    {
      id: 'listing',
      title: 'Listing',
      type: 'market-selector',
      layout: 'full',
      required: true,
      dependsOn: ['provider'],
    },
    ...providerParamSubBlocks,
    {
      id: 'interval',
      title: 'Interval',
      type: 'dropdown',
      layout: 'full',
      placeholder: 'Select interval',
      required: false,
      condition: providersWithIntervals.length
        ? { field: 'provider', value: providersWithIntervals }
        : undefined,
      dependsOn: ['provider'],
      fetchOptions: async (_blockId, _subBlockId, contextValues) => {
        const provider = resolveContextValue(contextValues, 'provider')
        if (!provider) return []
        const capabilities = getMarketSeriesCapabilities(provider)
        const intervals = capabilities?.intervals ?? []
        return intervals.map((interval) => ({
          label: formatIntervalLabel(interval),
          id: interval,
        }))
      },
    },
    {
      id: 'normalizationMode',
      title: 'Normalization',
      type: 'dropdown',
      layout: 'full',
      placeholder: 'Optional normalization mode',
      required: false,
      condition: providersWithNormalization.length
        ? { field: 'provider', value: providersWithNormalization }
        : undefined,
      dependsOn: ['provider'],
      fetchOptions: async (_blockId, _subBlockId, contextValues) => {
        const provider = resolveContextValue(contextValues, 'provider')
        if (!provider) return []
        const modes = getMarketSeriesCapabilities(provider)?.normalizationModes ?? []
        return modes.map((mode) => ({
          label: mode.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
          id: mode,
        }))
      },
    },
    {
      id: 'start',
      title: 'Start',
      type: 'datetime-input',
      layout: 'full',
      placeholder: 'Start time',
      timePicker: { hour: true, minute: true, second: false },
      required: true,
    },
    {
      id: 'end',
      title: 'End',
      type: 'datetime-input',
      layout: 'full',
      placeholder: 'End time',
      timePicker: { hour: true, minute: true, second: false },
      required: true,
    },
  ],
  tools: {
    access: ['historical_data_fetch'],
    config: {
      tool: () => 'historical_data_fetch',
      params: (params) => {
        const resolvedProviderParams: Record<string, any> = {}
        providerParamIds.forEach((paramId) => {
          const entry = providerParamRegistry[paramId]
          if (!entry) return
          const value = coerceMarketProviderParamValue(entry.definition, params[paramId])
          if (value !== undefined) {
            resolvedProviderParams[paramId] = value
          }
        })

        const interval = sanitizeInterval(params.provider, params.interval)
        const normalizationMode = sanitizeNormalizationMode(params.provider, params.normalizationMode)

        let mergedProviderParams: Record<string, any> | undefined =
          Object.keys(resolvedProviderParams).length ? resolvedProviderParams : undefined

        if (mergedProviderParams) {
          if (interval === undefined) {
            delete mergedProviderParams.interval
          }
          if (normalizationMode === undefined) {
            delete mergedProviderParams.normalizationMode
          }
          if (!Object.keys(mergedProviderParams).length) {
            mergedProviderParams = undefined
          }
        }

        return {
          provider: params.provider,
          listing: params.listing,
          interval,
          start: params.start,
          end: params.end,
          normalizationMode,
          providerParams: mergedProviderParams,
          ...resolvedProviderParams,
        }
      },
    },
  },
  inputs: {
    provider: { type: 'string', description: 'Market provider id' },
    listing: { type: 'json', description: 'Structured listing payload' },
    interval: { type: 'string', description: 'Series interval/timeframe' },
    start: { type: 'string', description: 'Inclusive start of the interval (ISO or UNIX timestamp)' },
    end: { type: 'string', description: 'Inclusive end of the interval (ISO or UNIX timestamp)' },
    normalizationMode: { type: 'string', description: 'Optional normalization mode' },
    ...providerParamIds.reduce<
      Record<string, { type: 'string' | 'number' | 'boolean' | 'json' | 'array'; description?: string }>
    >(
      (acc, paramId) => {
        const entry = providerParamRegistry[paramId]
        if (!entry) return acc
        acc[paramId] = {
          type: entry.definition.type,
          description: entry.definition.description,
        }
        return acc
      },
      {}
    ),
  },
  outputs: {
    listingBase: { type: 'string', description: 'Listing base symbol' },
    listingQuote: { type: 'string', description: 'Listing quote currency' },
    listing: {
      type: 'json',
      description: 'Structured listing identifier payload',
    },
    bars: {
      type: 'array',
      description: 'OHLCV bars with timestamps',
    },
    start: { type: 'string', description: 'Start of the returned series' },
    end: { type: 'string', description: 'End of the returned series' },
    timezone: { type: 'string', description: 'Exchange timezone' },
    normalizationMode: { type: 'string', description: 'Normalization mode used' },
  },
}
