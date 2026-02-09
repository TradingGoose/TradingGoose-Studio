import type React from 'react'
import type { AssetClass } from '@/providers/market/types'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'
import { robinhoodTradingProviderConfig } from '@/providers/trading/robinhood/config'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'
import type {
  TradingAuthType,
  TradingFieldDefinition,
  TradingHoldingsInput,
  TradingHoldingsNormalizationContext,
  TradingOperationKind,
  TradingOrder,
  TradingOrderInput,
  TradingProviderId,
  TradingProviderOAuthConfig,
  TradingRequestConfig,
  UnifiedTradingAccountSnapshot,
} from '@/providers/trading/types'

export type TradingProviderResponse = TradingOrder | UnifiedTradingAccountSnapshot

export interface TradingProviderAvailability {
  assetClass: AssetClass[]
  order: boolean
  holdings: boolean
  availableListingQuote?: string[]
  availableCurrencyBase?: string[]
  availableCurrencyQuote?: string[]
  availableCryptoBase?: string[]
  availableCryptoQuote?: string[]
}

export interface TradingOrderInputCapabilities {
  orderTypes?: TradingOrderTypeDefinition[]
  timeInForce?: string[]
  supportsLimit?: boolean
  supportsStop?: boolean
  supportsFractional?: boolean
}

export interface TradingHoldingsInputCapabilities {
  supportsPositions?: boolean
}

export interface TradingProviderCapabilities {
  order?: TradingOrderInputCapabilities
  holdings?: TradingHoldingsInputCapabilities
}

export type TradingProviderParamType = 'string' | 'number' | 'boolean' | 'json' | 'array'

export type TradingProviderParamVisibility = 'user-or-llm' | 'user-only' | 'llm-only' | 'hidden'

export type TradingProviderParamInputType =
  | 'short-input'
  | 'long-input'
  | 'dropdown'
  | 'combobox'
  | 'switch'
  | 'code'
  | 'slider'

export interface TradingProviderParamOption {
  id: string
  label: string
}

export interface TradingProviderParamCondition {
  field: string
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
  and?: TradingProviderParamCondition | TradingProviderParamCondition[]
}

export interface TradingProviderParamDefinition {
  id: string
  type: TradingProviderParamType
  title?: string
  description?: string
  placeholder?: string
  required?: boolean
  visibility?: TradingProviderParamVisibility
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>
  inputType?: TradingProviderParamInputType
  options?: TradingProviderParamOption[]
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
  condition?: TradingProviderParamCondition
  displayOrder?: number
}

export type TradingOrderTypeRequirement = 'limitPrice' | 'stopPrice' | 'trailPrice' | 'trailPercent'

export interface TradingOrderTypeDefinition {
  id: string
  label: string
  assetClasses?: AssetClass[]
  orderClasses?: string[]
  requires?: TradingOrderTypeRequirement[]
}

export interface TradingProviderParamConfig {
  shared?: TradingProviderParamDefinition[]
  order?: TradingProviderParamDefinition[]
  holdings?: TradingProviderParamDefinition[]
}

export type TradingProviderEndpointMap = Partial<Record<TradingOperationKind | 'default', string>>

export type TradingRuleScopeKey =
  | 'listing'
  | 'market'
  | 'currency'
  | 'assetClass'
  | 'country'
  | 'city'

export interface TradingSymbolRule {
  assetClass?: AssetClass
  listingKey?: string
  market?: string
  country?: string
  city?: string
  currency?: string
  regex?: string
  template: string
  active?: boolean
}

export interface TradingProviderConfig {
  id: TradingProviderId
  name: string
  availability: TradingProviderAvailability
  capabilities?: TradingProviderCapabilities
  params?: TradingProviderParamConfig
  api_endpoints?: TradingProviderEndpointMap
  rulePrecedence: Record<string, TradingRuleScopeKey[]>
  exchangeCodeToMarket: Record<string, string>
  marketToExchangeCode: Record<string, string>
  exchangeCodes: string[]
  rules: TradingSymbolRule[]
}

export interface TradingProvider {
  id: TradingProviderId
  name: string
  config: TradingProviderConfig
  defaults?: {
    orderType?: string
    timeInForce?: string
  }
  buildOrderRequest?: (params: TradingOrderInput) => TradingRequestConfig
  buildHoldingsRequest?: (params: TradingHoldingsInput) => TradingRequestConfig
  normalizeOrder?: (data: any) => TradingOrder
  normalizeHoldings?: (
    data: any,
    context?: TradingHoldingsNormalizationContext
  ) => UnifiedTradingAccountSnapshot
}

export interface TradingProviderDefinition {
  id: TradingProviderId
  name: string
  description: string
  authType: TradingAuthType
  oauth?: TradingProviderOAuthConfig
  credentialFields?: Array<{
    id: string
    label: string
    secret?: boolean
    description?: string
  }>
  fields?: TradingFieldDefinition[]
  defaults?: {
    orderType?: string
    timeInForce?: string
  }
  config: TradingProviderConfig
  icon?: React.ComponentType<{ className?: string }>
}

export const TRADING_PROVIDER_DEFINITIONS: Record<string, TradingProviderDefinition> = {
  alpaca: {
    id: 'alpaca',
    name: 'Alpaca',
    description: 'Commission-free trading via Alpaca (paper and live).',
    authType: 'oauth',
    oauth: {
      provider: 'alpaca',
      serviceId: 'alpaca',
      scopes: ['account:write', 'trading', 'data'],
      credentialTitle: 'Alpaca Account',
      credentialPlaceholder: 'Select Alpaca account',
    },
    credentialFields: [],
    defaults: {
      orderType: 'market',
      timeInForce: 'day',
    },
    config: alpacaTradingProviderConfig,
  },
  tradier: {
    id: 'tradier',
    name: 'Tradier',
    description: 'Retail trading via Tradier Brokerage.',
    authType: 'oauth',
    oauth: {
      provider: 'tradier',
      serviceId: 'tradier',
      scopes: ['read', 'write', 'trade'],
      credentialTitle: 'Tradier Account',
      credentialPlaceholder: 'Select or connect Tradier account',
    },
    fields: [
      {
        id: 'accountId',
        label: 'Tradier Account ID',
        type: 'string',
        for: 'both',
        required: true,
        description: 'Account number used in Tradier endpoints.',
      },
    ],
    defaults: {
      orderType: 'market',
      timeInForce: 'day',
    },
    config: tradierTradingProviderConfig,
  },
  robinhood: {
    id: 'robinhood',
    name: 'Robinhood',
    description: 'Robinhood brokerage (OAuth).',
    authType: 'oauth',
    oauth: {
      provider: 'robinhood',
      serviceId: 'robinhood',
      scopes: ['internal', 'read', 'trading'],
      credentialTitle: 'Robinhood Account',
      credentialPlaceholder: 'Select or connect Robinhood account',
    },
    fields: [
      {
        id: 'accountUrl',
        label: 'Robinhood Account URL',
        type: 'string',
        for: 'both',
        required: false,
        description: 'Account resource URL (optional if default account is used).',
      },
      {
        id: 'instrumentUrl',
        label: 'Instrument URL',
        type: 'string',
        for: 'order',
        required: true,
        description:
          'Instrument resource URL for the symbol (can be retrieved via /instruments?symbol=SYMBOL).',
      },
    ],
    defaults: {
      orderType: 'market',
      timeInForce: 'gfd',
    },
    config: robinhoodTradingProviderConfig,
  },
}

export function getTradingProviderDefinition(
  providerId: TradingProviderId
): TradingProviderDefinition | null {
  return TRADING_PROVIDER_DEFINITIONS[providerId] || null
}

export function getTradingProviderConfig(
  providerId: TradingProviderId
): TradingProviderConfig | null {
  return TRADING_PROVIDER_DEFINITIONS[providerId]?.config || null
}

export function getTradingProviderAvailability(
  providerId: TradingProviderId
): TradingProviderAvailability {
  return (
    TRADING_PROVIDER_DEFINITIONS[providerId]?.config.availability || {
      assetClass: [],
      order: false,
      holdings: false,
    }
  )
}

export function getTradingProviderCapabilities(
  providerId: TradingProviderId
): TradingProviderCapabilities | null {
  return TRADING_PROVIDER_DEFINITIONS[providerId]?.config.capabilities || null
}

export function getTradingProviderKinds(providerId: TradingProviderId): TradingOperationKind[] {
  const availability = getTradingProviderAvailability(providerId)
  const kinds = new Set<TradingOperationKind>()

  if (availability.order) kinds.add('order')
  if (availability.holdings) kinds.add('holdings')

  return Array.from(kinds)
}

export function getTradingProviders(): TradingProviderDefinition[] {
  return Object.values(TRADING_PROVIDER_DEFINITIONS)
}

export function getTradingProviderOptions(): Array<{ id: string; name: string }> {
  return Object.values(TRADING_PROVIDER_DEFINITIONS).map((provider) => ({
    id: provider.id,
    name: provider.name,
  }))
}

export function getTradingProvidersByKind(kind: TradingOperationKind): TradingProviderDefinition[] {
  return Object.values(TRADING_PROVIDER_DEFINITIONS).filter((provider) => {
    const availability = provider.config.availability
    if (kind === 'order') return availability.order
    return availability.holdings
  })
}

export function getTradingProviderOptionsByKind(
  kind: TradingOperationKind
): Array<{ id: string; name: string }> {
  return getTradingProvidersByKind(kind).map((provider) => ({
    id: provider.id,
    name: provider.name,
  }))
}

export interface TradingProviderParamRegistryEntry {
  definition: TradingProviderParamDefinition
  providers: string[]
}

export interface TradingProviderParamCatalog {
  order: string[]
  registry: Record<string, TradingProviderParamRegistryEntry>
}

export function getTradingProviderParamDefinitions(
  providerId: TradingProviderId,
  kind: TradingOperationKind
): TradingProviderParamDefinition[] {
  const config = getTradingProviderConfig(providerId)
  if (!config?.params) return []

  const shared = config.params.shared ?? []
  const scoped = kind === 'order' ? config.params.order : config.params.holdings

  const combined = [...shared, ...(scoped ?? [])]
  const seen = new Set<string>()
  const deduped: TradingProviderParamDefinition[] = []

  combined.forEach((param) => {
    if (!param?.id || seen.has(param.id)) return
    seen.add(param.id)
    deduped.push(param)
  })

  return deduped
}

function mergeParamVisibility(
  current?: TradingProviderParamVisibility,
  next?: TradingProviderParamVisibility
): TradingProviderParamVisibility | undefined {
  if (!current) return next
  if (!next) return current

  const priority: Record<TradingProviderParamVisibility, number> = {
    hidden: 0,
    'user-only': 1,
    'user-or-llm': 2,
    'llm-only': 3,
  }

  return priority[current] <= priority[next] ? current : next
}

function mergeParamDefinition(
  current: TradingProviderParamDefinition,
  next: TradingProviderParamDefinition
): TradingProviderParamDefinition {
  const merged: TradingProviderParamDefinition = {
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
    condition: current.condition ?? next.condition,
    displayOrder: current.displayOrder ?? next.displayOrder,
  }

  merged.required = Boolean(current.required) && Boolean(next.required)
  merged.visibility = mergeParamVisibility(current.visibility, next.visibility)

  return merged
}

export function getTradingProviderParamCatalog(
  kind: TradingOperationKind
): TradingProviderParamCatalog {
  const registry: Record<string, TradingProviderParamRegistryEntry> = {}
  const order: string[] = []

  const providers = getTradingProvidersByKind(kind)
  providers.forEach((provider) => {
    const defs = getTradingProviderParamDefinitions(provider.id, kind)
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

export function getTradingProviderParamRegistry(
  kind: TradingOperationKind
): Record<string, TradingProviderParamRegistryEntry> {
  return getTradingProviderParamCatalog(kind).registry
}

export function getTradingProviderIdsForParam(
  kind: TradingOperationKind,
  paramId: string
): TradingProviderId[] {
  const registry = getTradingProviderParamRegistry(kind)
  return (registry[paramId]?.providers ?? []) as TradingProviderId[]
}

export function coerceTradingProviderParamValue(
  definition: TradingProviderParamDefinition,
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

function mapParamTypeToFieldType(
  paramType: TradingProviderParamType
): TradingFieldDefinition['type'] {
  switch (paramType) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'dropdown'
    default:
      return 'string'
  }
}

export function getProviderFields(
  providerId: TradingProviderId,
  forOperation: TradingOperationKind
): TradingFieldDefinition[] {
  const provider = getTradingProviderDefinition(providerId)
  if (!provider) return []

  if (provider.fields?.length) {
    return provider.fields.filter((field) => field.for === forOperation || field.for === 'both')
  }

  const definitions = getTradingProviderParamDefinitions(providerId, forOperation)
  return definitions.map((param) => ({
    id: param.id,
    label: param.title || param.id,
    type: mapParamTypeToFieldType(param.type),
    for: forOperation,
    required: param.required,
    placeholder: param.placeholder,
    description: param.description,
    options: param.options,
  }))
}
