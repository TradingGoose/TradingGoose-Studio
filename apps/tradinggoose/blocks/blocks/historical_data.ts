import { ChartBarIcon } from '@/components/icons'
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
    'Choose a market data provider, select a canonical listing, and fetch normalized candles that include open, high, low, close, volume, and timestamps. Start and end can be ISO strings or UNIX timestamps.',
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
      id: 'listingId',
      title: 'Listing',
      type: 'market-selector',
      layout: 'full',
      required: true,
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
        return intervals.map((interval) => ({ label: interval, id: interval }))
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
    {
      id: 'providerParams',
      title: 'Provider Params',
      type: 'code',
      layout: 'full',
      mode: 'advanced',
      language: 'json',
      placeholder: '{\n  "example": "value"\n}',
    },
  ],
  tools: {
    access: ['historical_data_fetch'],
    config: {
      params: (params) => {
        let providerParams: Record<string, any> | undefined
        if (params.providerParams) {
          if (typeof params.providerParams === 'string') {
            try {
              providerParams = JSON.parse(params.providerParams)
            } catch (error) {
              throw new Error('Provider Params must be valid JSON')
            }
          } else if (typeof params.providerParams === 'object') {
            providerParams = params.providerParams as Record<string, any>
          }
        }

        const resolvedProviderParams: Record<string, any> = {}
        providerParamIds.forEach((paramId) => {
          const entry = providerParamRegistry[paramId]
          if (!entry) return
          const value = coerceMarketProviderParamValue(entry.definition, params[paramId])
          if (value !== undefined) {
            resolvedProviderParams[paramId] = value
          }
        })

        return {
          provider: params.provider,
          listingId: params.listingId,
          interval: params.interval || undefined,
          start: params.start,
          end: params.end,
          normalizationMode: params.normalizationMode || undefined,
          providerParams:
            providerParams && typeof providerParams === 'object'
              ? { ...providerParams, ...resolvedProviderParams }
              : Object.keys(resolvedProviderParams).length
                ? resolvedProviderParams
                : undefined,
          ...resolvedProviderParams,
        }
      },
    },
  },
  inputs: {
    provider: { type: 'string', description: 'Market provider id' },
    listingId: { type: 'string', description: 'Canonical listing id' },
    interval: { type: 'string', description: 'Series interval/timeframe' },
    start: { type: 'string', description: 'Inclusive start of the interval (ISO or UNIX timestamp)' },
    end: { type: 'string', description: 'Inclusive end of the interval (ISO or UNIX timestamp)' },
    normalizationMode: { type: 'string', description: 'Optional normalization mode' },
    providerParams: { type: 'json', description: 'Optional provider-specific parameters' },
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
    listingId: { type: 'string', description: 'Listing id for the returned series' },
    close: { type: 'array', description: 'Close prices' },
    high: { type: 'array', description: 'High prices' },
    low: { type: 'array', description: 'Low prices' },
    open: { type: 'array', description: 'Open prices' },
    date: { type: 'array', description: 'ISO timestamps for each bar' },
    volume: { type: 'array', description: 'Volume for each bar' },
    timezone: { type: 'string', description: 'Exchange timezone' },
    normalizationMode: { type: 'string', description: 'Normalization mode used' },
  },
}
