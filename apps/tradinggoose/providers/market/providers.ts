/**
 * Market provider definitions - Single source of truth
 * This file contains provider metadata and provider-facing types including:
 * - Availability by data type
 * - Supported asset classes/currencies
 * - Provider configurations
 */

import type React from 'react'
import type {
  AssetClass,
  MarketDataAvailability,
  MarketDataType,
  MarketInterval,
  MarketLiveRequest,
  MarketLiveSnapshot,
  MarketSeriesRequest,
  MarketSeries,
  NormalizationMode,
} from '@/providers/market/types'
import { alphaVantageProviderConfig } from '@/providers/market/alpha-vantage/config'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'
import { YahooFinanceProviderConfig } from '@/providers/market/yahoo-finance/config'

export type { MarketProviderRequest } from '@/providers/market/types'

export type MarketProviderResponse = MarketSeries | MarketLiveSnapshot

export interface MarketSeriesInputCapabilities {
  supportsInterval?: boolean
  intervals?: MarketInterval[]
  supportsStartEnd?: boolean
  normalizationModes?: NormalizationMode[]
}

export interface MarketLiveInputCapabilities {
  supportsStreaming?: boolean
  channels?: string[]
  supportsInterval?: boolean
  intervals?: string[]
}

export interface MarketProviderCapabilities {
  series?: MarketSeriesInputCapabilities
  live?: MarketLiveInputCapabilities
}

export type MarketProviderParamType = 'string' | 'number' | 'boolean' | 'json' | 'array'

export type MarketProviderParamVisibility =
  | 'user-or-llm'
  | 'user-only'
  | 'llm-only'
  | 'hidden'

export type MarketProviderParamInputType =
  | 'short-input'
  | 'long-input'
  | 'dropdown'
  | 'combobox'
  | 'switch'
  | 'code'
  | 'slider'

export interface MarketProviderParamOption {
  id: string
  label: string
}

export interface MarketProviderParamDefinition {
  id: string
  type: MarketProviderParamType
  title?: string
  description?: string
  placeholder?: string
  required?: boolean
  visibility?: MarketProviderParamVisibility
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>
  inputType?: MarketProviderParamInputType
  options?: MarketProviderParamOption[]
  fetchOptions?: (
    blockId: string,
    subBlockId: string,
    contextValues?: Record<string, any>
  ) => Promise<Array<{ label: string; id: string }>>
  password?: boolean
  mode?: 'basic' | 'advanced' | 'both'
  layout?: 'full' | 'half'
  min?: number
  max?: number
  step?: number
  integer?: boolean
  rows?: number
  dependsOn?: string[]
}

export interface MarketProviderParamConfig {
  shared?: MarketProviderParamDefinition[]
  series?: MarketProviderParamDefinition[]
  live?: MarketProviderParamDefinition[]
}

export type MarketProviderSeriesEndpointMap = Partial<Record<AssetClass | 'default', string>>

export type RuleScopeKey = 'listing' | 'mic' | 'currency' | 'assetClass' | 'country' | 'city'

export interface MarketSymbolRule {
  assetClass?: AssetClass
  listingId?: string
  mic?: string
  country?: string
  city?: string
  currency?: string
  regex?: string
  template: string
  active?: boolean
}

export interface MarketProviderConfig {
  id: string
  name: string
  // Source timestamp offset relative to UTC in hours (e.g., -5, 0, +3).
  utcOffset?: number
  availability: MarketDataAvailability
  capabilities?: MarketProviderCapabilities
  params?: MarketProviderParamConfig
  api_endpoints?: MarketProviderSeriesEndpointMap
  rulePrecedence: Record<string, RuleScopeKey[]>
  exchangeCodeToMic: Record<string, string[]>
  micToExchangeCode: Record<string, string>
  exchangeCodes: string[]
  rules: MarketSymbolRule[]
}

export interface MarketProvider {
  id: string
  name: string
  config: MarketProviderConfig
  fetchMarketSeries?: (request: MarketSeriesRequest) => Promise<MarketSeries>
  fetchMarketLive?: (request: MarketLiveRequest) => Promise<MarketLiveSnapshot>
}

export interface ListingContext {
  listingId: string
  base: string
  quote?: string
  assetClass?: AssetClass
  primaryMicCode?: string
  micCode?: string
  exchangeCode?: string
  exchangeSuffix?: string
  countryCode?: string
  cityName?: string
  timeZoneName?: string
}

export interface MarketProviderDefinition {
  id: string
  name: string
  description: string
  config: MarketProviderConfig
  icon?: React.ComponentType<{ className?: string }>
}

export const MARKET_PROVIDER_DEFINITIONS: Record<string, MarketProviderDefinition> = {
  'alpha-vantage': {
    id: 'alpha-vantage',
    name: 'Alpha Vantage',
    description: 'Alpha Vantage market data (time series).',
    config: alphaVantageProviderConfig,
  },
  alpaca: {
    id: 'alpaca',
    name: 'Alpaca',
    description: 'Alpaca market data (stock & crypto bars).',
    config: alpacaProviderConfig,
  },
  'yahoo-finance': {
    id: 'yahoo-finance',
    name: 'Yahoo Finance',
    description: 'Yahoo Finance market data (charts/quotes).',
    config: YahooFinanceProviderConfig,
  },
  finnhub: {
    id: 'finnhub',
    name: 'Finnhub',
    description: 'Finnhub market data (candles).',
    config: finnhubProviderConfig,
  },
}

export function getMarketProviderDefinition(
  providerId: string
): MarketProviderDefinition | null {
  return MARKET_PROVIDER_DEFINITIONS[providerId] || null
}

export function getMarketProviderConfig(providerId: string): MarketProviderConfig | null {
  return MARKET_PROVIDER_DEFINITIONS[providerId]?.config || null
}

export function getMarketProviderAvailability(providerId: string): MarketDataAvailability {
  return (
    MARKET_PROVIDER_DEFINITIONS[providerId]?.config.availability || {
      assetClass: [],
      series: false,
      live: false,
    }
  )
}

export function getMarketProviderCapabilities(
  providerId: string
): MarketProviderCapabilities | null {
  return MARKET_PROVIDER_DEFINITIONS[providerId]?.config.capabilities || null
}

export function getMarketSeriesCapabilities(
  providerId: string
): MarketSeriesInputCapabilities | null {
  return getMarketProviderCapabilities(providerId)?.series || null
}

export function getMarketLiveCapabilities(providerId: string): MarketLiveInputCapabilities | null {
  return getMarketProviderCapabilities(providerId)?.live || null
}
export function getMarketProviderExchangeCodes(providerId: string): string[] {
  return MARKET_PROVIDER_DEFINITIONS[providerId]?.config.exchangeCodes || []
}

export function getMarketProviderKinds(providerId: string): MarketDataType[] {
  const availability = getMarketProviderAvailability(providerId)
  const kinds = new Set<MarketDataType>()

  if (availability.series) kinds.add('series')
  if (availability.live) kinds.add('live')

  return Array.from(kinds)
}

export function getMarketProviderOptions(): Array<{ id: string; name: string }> {
  return Object.values(MARKET_PROVIDER_DEFINITIONS).map((provider) => ({
    id: provider.id,
    name: provider.name,
  }))
}

export function getMarketProvidersByKind(kind: MarketDataType): MarketProviderDefinition[] {
  return Object.values(MARKET_PROVIDER_DEFINITIONS).filter((provider) => {
    const availability = provider.config.availability
    if (kind === 'series') return availability.series
    return availability.live
  })
}

export function getMarketProviderOptionsByKind(
  kind: MarketDataType
): Array<{ id: string; name: string }> {
  return getMarketProvidersByKind(kind).map((provider) => ({
    id: provider.id,
    name: provider.name,
  }))
}

export interface MarketProviderParamRegistryEntry {
  definition: MarketProviderParamDefinition
  providers: string[]
}

export interface MarketProviderParamCatalog {
  order: string[]
  registry: Record<string, MarketProviderParamRegistryEntry>
}

export function getMarketProviderParamDefinitions(
  providerId: string,
  kind: MarketDataType
): MarketProviderParamDefinition[] {
  const config = getMarketProviderConfig(providerId)
  if (!config?.params) return []

  const shared = config.params.shared ?? []
  const scoped =
    kind === 'series'
      ? config.params.series
      : config.params.live

  const combined = [...shared, ...(scoped ?? [])]
  const seen = new Set<string>()
  const deduped: MarketProviderParamDefinition[] = []

  combined.forEach((param) => {
    if (!param?.id || seen.has(param.id)) return
    seen.add(param.id)
    deduped.push(param)
  })

  return deduped
}

function mergeParamVisibility(
  current?: MarketProviderParamVisibility,
  next?: MarketProviderParamVisibility
): MarketProviderParamVisibility | undefined {
  if (!current) return next
  if (!next) return current

  const priority: Record<MarketProviderParamVisibility, number> = {
    hidden: 0,
    'user-only': 1,
    'user-or-llm': 2,
    'llm-only': 3,
  }

  return priority[current] <= priority[next] ? current : next
}

function mergeParamDefinition(
  current: MarketProviderParamDefinition,
  next: MarketProviderParamDefinition
): MarketProviderParamDefinition {
  const merged: MarketProviderParamDefinition = {
    ...current,
    description: current.description || next.description,
    title: current.title || next.title,
    placeholder: current.placeholder || next.placeholder,
    inputType: current.inputType || next.inputType,
    options: current.options?.length ? current.options : next.options,
    password: current.password ?? next.password,
    defaultValue: current.defaultValue ?? next.defaultValue,
    fetchOptions: current.fetchOptions ?? next.fetchOptions,
    mode: current.mode || next.mode,
    layout: current.layout || next.layout,
    min: current.min ?? next.min,
    max: current.max ?? next.max,
    step: current.step ?? next.step,
    integer: current.integer ?? next.integer,
    rows: current.rows ?? next.rows,
    dependsOn: current.dependsOn ?? next.dependsOn,
  }

  merged.required = Boolean(current.required) && Boolean(next.required)
  merged.visibility = mergeParamVisibility(current.visibility, next.visibility)

  return merged
}

export function getMarketProviderParamCatalog(kind: MarketDataType): MarketProviderParamCatalog {
  const registry: Record<string, MarketProviderParamRegistryEntry> = {}
  const order: string[] = []

  const providers = getMarketProvidersByKind(kind)
  providers.forEach((provider) => {
    const defs = getMarketProviderParamDefinitions(provider.id, kind)
    defs.forEach((param) => {
      if (!param?.id) return

      const existing = registry[param.id]
      if (!existing) {
        registry[param.id] = {
          definition: { ...param },
          providers: [provider.id],
        }
        order.push(param.id)
        return
      }

      if (!existing.providers.includes(provider.id)) {
        existing.providers.push(provider.id)
      }
      existing.definition = mergeParamDefinition(existing.definition, param)
    })
  })

  return { order, registry }
}

export function getMarketProviderParamRegistry(
  kind: MarketDataType
): Record<string, MarketProviderParamRegistryEntry> {
  return getMarketProviderParamCatalog(kind).registry
}

export function coerceMarketProviderParamValue(
  definition: MarketProviderParamDefinition,
  value: unknown
): unknown {
  if (value === undefined || value === null || value === '') return undefined

  switch (definition.type) {
    case 'number': {
      if (typeof value === 'number') return value
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : value
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true
        if (value.toLowerCase() === 'false') return false
      }
      return value
    }
    case 'json':
    case 'array': {
      if (typeof value !== 'string') return value
      try {
        return JSON.parse(value)
      } catch (error) {
        throw new Error(
          `Invalid JSON for ${definition.title || definition.id}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    default:
      return value
  }
}
