import type React from 'react'
import { getCanonicalScopesForProvider } from '@/lib/oauth'
import type { AssetClass } from '@/providers/market/types'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'
import type {
  TradingAuthType,
  TradingOperationKind,
  TradingOrder,
  TradingOrderDetailInput,
  TradingOrderDetailResult,
  TradingOrderHistoryRecord,
  TradingOrderInput,
  TradingPortfolioPerformanceWindow,
  TradingProviderId,
  TradingProviderOAuthConfig,
  TradingRequestConfig,
} from '@/providers/trading/types'

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
}

export interface TradingHoldingsInputCapabilities {
  performanceWindows?: TradingPortfolioPerformanceWindow[]
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
  orderDetailRequest?: (
    historyRecord: TradingOrderHistoryRecord,
    params: TradingOrderDetailInput
  ) => Promise<TradingOrderDetailResult>
  normalizeOrder?: (data: any) => TradingOrder
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
    description: 'Commission-free trading via Alpaca.',
    authType: 'oauth',
    oauth: {
      provider: 'alpaca',
      credentialServices: [
        { serviceId: 'alpaca-live', environment: 'live' },
        { serviceId: 'alpaca-paper', environment: 'paper' },
      ],
      scopes: getCanonicalScopesForProvider('alpaca-live'),
      credentialTitle: 'Alpaca Account',
      credentialPlaceholder: 'Select or connect Alpaca connection',
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
      credentialServices: [{ serviceId: 'tradier-live', environment: 'live' }],
      scopes: getCanonicalScopesForProvider('tradier-live'),
      credentialTitle: 'Tradier Account',
      credentialPlaceholder: 'Select or connect Tradier connection',
    },
    defaults: {
      orderType: 'market',
      timeInForce: 'day',
    },
    config: tradierTradingProviderConfig,
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

export function getTradingHoldingsCapabilities(
  providerId: TradingProviderId
): TradingHoldingsInputCapabilities | null {
  return TRADING_PROVIDER_DEFINITIONS[providerId]?.config.capabilities?.holdings || null
}

export function getTradingProviders(): TradingProviderDefinition[] {
  return Object.values(TRADING_PROVIDER_DEFINITIONS)
}

export function getTradingProviderOAuthCredentialServices(providerId: TradingProviderId) {
  const provider = getTradingProviderDefinition(providerId)
  return provider?.oauth?.credentialServices ?? []
}

export function getTradingProviderOAuthServiceIds(providerId: TradingProviderId): string[] {
  return (getTradingProviderOAuthCredentialServices(providerId) ?? []).map(
    (service) => service.serviceId
  )
}

export function resolveTradingProviderOAuthCredentialService(
  providerId: TradingProviderId,
  serviceId?: string | null
) {
  const services = getTradingProviderOAuthCredentialServices(providerId)
  if (!services || services.length === 0) return null

  const requestedServiceId = serviceId?.trim()
  if (requestedServiceId) {
    return services.find((service) => service.serviceId === requestedServiceId) ?? null
  }

  return services.length === 1 ? (services[0] ?? null) : null
}

export function getTradingProviderOAuthServiceId(
  providerId: TradingProviderId,
  serviceId?: string | null
): string | null {
  return resolveTradingProviderOAuthCredentialService(providerId, serviceId)?.serviceId ?? null
}

export function getTradingProviderOAuthEnvironment(
  providerId: TradingProviderId,
  serviceId?: string | null
) {
  return resolveTradingProviderOAuthCredentialService(providerId, serviceId)?.environment ?? null
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

export function getAvailableTradingProviders(
  providerAvailability: Record<string, boolean>,
  kind?: TradingOperationKind
): TradingProviderDefinition[] {
  const providers = kind ? getTradingProvidersByKind(kind) : getTradingProviders()

  return providers.filter((provider) => {
    const oauthServiceIds = getTradingProviderOAuthServiceIds(provider.id)
    if (oauthServiceIds.length === 0) return true
    return oauthServiceIds.some((oauthServiceId) => Boolean(providerAvailability[oauthServiceId]))
  })
}

export function getAvailableTradingProviderOptions(
  providerAvailability: Record<string, boolean>,
  kind?: TradingOperationKind
): Array<{ id: string; name: string }> {
  return getAvailableTradingProviders(providerAvailability, kind).map((provider) => ({
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

function mergeParamCondition(
  current?: TradingProviderParamCondition,
  next?: TradingProviderParamCondition
): TradingProviderParamCondition | undefined {
  return JSON.stringify(current ?? null) === JSON.stringify(next ?? null) ? current : undefined
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
    condition: mergeParamCondition(current.condition, next.condition),
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
