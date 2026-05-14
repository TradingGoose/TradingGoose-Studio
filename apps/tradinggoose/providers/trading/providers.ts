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
  TradingOrderSizingMode,
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
  orderMethods?: TradingOrderMethodDefinition[]
  orderTypes?: TradingOrderTypeDefinition[]
  sizingModes?: TradingOrderSizingModeDefinition[]
  timeInForce?: string[]
  preview?: boolean
}

export interface TradingHoldingsInputCapabilities {
  performanceWindows?: TradingPortfolioPerformanceWindow[]
}

export interface TradingProviderCapabilities {
  order?: TradingOrderInputCapabilities
  holdings?: TradingHoldingsInputCapabilities
}

export type TradingOrderTypeRequirement = 'limitPrice' | 'stopPrice' | 'trailPrice' | 'trailPercent'
export type TradingOrderMethodRequirement = 'optionSymbol' | 'legs'

export interface TradingOrderMethodDefinition {
  id: string
  label: string
  assetClasses?: AssetClass[]
  requires?: TradingOrderMethodRequirement[]
}

export interface TradingOrderTypeDefinition {
  id: string
  label: string
  assetClasses?: AssetClass[]
  orderMethods?: string[]
  requires?: TradingOrderTypeRequirement[]
  requiresOneOf?: TradingOrderTypeRequirement[]
  excludes?: TradingOrderTypeRequirement[]
}

export interface TradingOrderSizingModeDefinition {
  id: TradingOrderSizingMode
  label: string
  orderTypes?: string[]
  timeInForce?: string[]
}

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
  rulePrecedence: Record<string, TradingRuleScopeKey[]>
  exchangeCodeToMarket: Record<string, string>
  marketToExchangeCode: Record<string, string>
  exchangeCodes: string[]
  rules: TradingSymbolRule[]
}

export interface TradingProviderAdapter {
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
    orderMethod?: string
    orderSizingMode?: TradingOrderSizingMode
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
      services: [
        { serviceId: 'alpaca-live', environment: 'live' },
        { serviceId: 'alpaca-paper', environment: 'paper' },
      ],
      scopes: getCanonicalScopesForProvider('alpaca-live'),
      credentialTitle: 'Alpaca Account',
      credentialPlaceholder: 'Select or connect Alpaca connection',
    },
    credentialFields: [],
    defaults: {
      orderSizingMode: 'quantity',
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
      services: [{ serviceId: 'tradier-live', environment: 'live' }],
      scopes: getCanonicalScopesForProvider('tradier-live'),
      credentialTitle: 'Tradier Account',
      credentialPlaceholder: 'Select or connect Tradier connection',
    },
    defaults: {
      orderMethod: 'equity',
      orderSizingMode: 'quantity',
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

export function getTradingOrderCapabilities(
  providerId?: TradingProviderId
): TradingOrderInputCapabilities | null {
  if (!providerId) return null
  return TRADING_PROVIDER_DEFINITIONS[providerId]?.config.capabilities?.order || null
}

export function getTradingProviders(): TradingProviderDefinition[] {
  return Object.values(TRADING_PROVIDER_DEFINITIONS)
}

export function getTradingProviderOAuthServices(providerId: TradingProviderId) {
  const provider = getTradingProviderDefinition(providerId)
  return provider?.oauth?.services ?? []
}

export function getTradingProviderOAuthServiceIds(providerId: TradingProviderId): string[] {
  return (getTradingProviderOAuthServices(providerId) ?? []).map((service) => service.serviceId)
}

export function isTradingProviderOAuthServiceId(serviceId: string): boolean {
  return getTradingProviders().some((provider) =>
    getTradingProviderOAuthServiceIds(provider.id).includes(serviceId)
  )
}

export function resolveTradingProviderOAuthService(
  providerId: TradingProviderId,
  serviceId?: string | null
) {
  const services = getTradingProviderOAuthServices(providerId)
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
  return resolveTradingProviderOAuthService(providerId, serviceId)?.serviceId ?? null
}

export function getTradingProviderOAuthEnvironment(
  providerId: TradingProviderId,
  serviceId?: string | null
) {
  return resolveTradingProviderOAuthService(providerId, serviceId)?.environment ?? null
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
