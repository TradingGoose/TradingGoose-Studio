import type { ListingInputValue } from '@/lib/listing/identity'
import { getTradingProvider } from '@/providers/trading'
import { getStrictTradingOrderTypeDefinitions } from '@/providers/trading/order-types'
import type { TradingOrderTypeDefinition } from '@/providers/trading/providers'
import { getTradingProviderParamDefinitions } from '@/providers/trading/providers'
import type { TradingOrderType, TradingProviderId } from '@/providers/trading/types'
import { resolveTradingListingAssetClass } from '@/providers/trading/utils'
import {
  getTradingWidgetEnvironmentOptions,
  getTradingWidgetProviderAvailabilityIds,
  getTradingWidgetProviderOptions,
  resolveTradingWidgetCredentialProvider,
  resolveTradingWidgetProviderId,
} from '@/widgets/utils/trading-widget-providers'
import {
  resolveConfiguredSeriesMarketProviderId,
  getSeriesMarketProviderOptions,
} from '@/widgets/widgets/data_chart/options'
import type { QuickOrderWidgetParams } from '@/widgets/widgets/quick_order/types'

export const QUICK_ORDER_WIDGET_KEY = 'quick_order'

export const getQuickOrderProviderAvailabilityIds = () =>
  getTradingWidgetProviderAvailabilityIds('order')

export const getQuickOrderProviderOptions = (providerAvailability?: Record<string, boolean>) => {
  return getTradingWidgetProviderOptions('order', providerAvailability)
}

export const resolveQuickOrderProviderId = (
  provider: unknown,
  providerAvailability?: Record<string, boolean>
) => {
  if (typeof provider !== 'string' || !provider.trim()) return undefined
  const providerId = provider.trim()
  const options = getQuickOrderProviderOptions(providerAvailability)
  return resolveTradingWidgetProviderId(providerId, options) || undefined
}

export const getQuickOrderEnvironmentOptions = (providerId?: string) => {
  return getTradingWidgetEnvironmentOptions(providerId, 'order').map((option) => option.id)
}

export const getQuickOrderDefaultEnvironment = (
  providerId?: string
): 'paper' | 'live' | undefined => {
  const options = getQuickOrderEnvironmentOptions(providerId)
  if (options.includes('paper')) return 'paper'
  return options[0]
}

export const resolveQuickOrderEnvironment = (
  providerId?: string,
  environment?: unknown
): 'paper' | 'live' | undefined => {
  const options = getQuickOrderEnvironmentOptions(providerId)
  if (typeof environment === 'string' && options.includes(environment as 'paper' | 'live')) {
    return environment as 'paper' | 'live'
  }
  return getQuickOrderDefaultEnvironment(providerId)
}

export const resolveQuickOrderCredentialProvider = (providerId?: string) => {
  return resolveTradingWidgetCredentialProvider(providerId)
}

export const getQuickOrderMarketProviderOptions = () => getSeriesMarketProviderOptions()

export const resolveQuickOrderMarketProviderId = (
  params: QuickOrderWidgetParams | null | undefined,
  options = getQuickOrderMarketProviderOptions()
) => resolveConfiguredSeriesMarketProviderId(params?.marketProvider, options)

export type QuickOrderSizingMode = 'quantity' | 'notional'

export type QuickOrderSizingModeConfig = {
  options: QuickOrderSizingMode[]
  defaultMode?: QuickOrderSizingMode
}

export const getQuickOrderSizingModeConfig = (providerId?: string): QuickOrderSizingModeConfig => {
  if (!providerId) return { options: [] }
  const sizingDefinition = getTradingProviderParamDefinitions(providerId, 'order').find(
    (definition) => definition.id === 'orderSizingMode'
  )
  const options =
    sizingDefinition?.options
      ?.map((option) => option.id)
      .filter(
        (value): value is QuickOrderSizingMode => value === 'quantity' || value === 'notional'
      ) ?? []
  const defaultValue = sizingDefinition?.defaultValue
  const defaultMode =
    typeof defaultValue === 'string' && options.includes(defaultValue as QuickOrderSizingMode)
      ? (defaultValue as QuickOrderSizingMode)
      : options[0]

  return { options, defaultMode }
}

export const getQuickOrderSizingModeOptions = (providerId?: string) =>
  getQuickOrderSizingModeConfig(providerId).options

export const getQuickOrderTimeInForceOptions = (providerId?: string) => {
  if (!providerId) return []
  const provider = getTradingProvider(providerId)
  return provider.config.capabilities?.order?.timeInForce ?? []
}

export const getQuickOrderDefaultTimeInForce = (providerId?: string) => {
  if (!providerId) return undefined
  const provider = getTradingProvider(providerId)
  const options = getQuickOrderTimeInForceOptions(providerId)
  return provider.defaults?.timeInForce ?? options[0]
}

const quickOrderTypeContext = (providerId?: TradingProviderId, listing?: ListingInputValue) => ({
  listing,
  orderClass: providerId === 'tradier' ? 'equity' : undefined,
})

export type QuickOrderOrderTypeOption = {
  id: string
  label: string
}

export type QuickOrderOrderTypeResolution =
  | {
      ok: true
      definition: TradingOrderTypeDefinition
      orderType: TradingOrderType
      options: QuickOrderOrderTypeOption[]
    }
  | {
      ok: false
      reason: 'no_supported_order_types' | 'unsupported_order_type'
      requestedOrderType?: string
      options: QuickOrderOrderTypeOption[]
    }

export type QuickOrderNumberParseResult =
  | { ok: true; value?: number }
  | { ok: false; reason: 'invalid_number'; rawValue: unknown }

export const getQuickOrderOrderTypeDefinitions = (
  providerId?: TradingProviderId,
  listing?: ListingInputValue
) => {
  if (!providerId || !listing || !resolveTradingListingAssetClass(listing)) return []
  return getStrictTradingOrderTypeDefinitions(
    providerId,
    quickOrderTypeContext(providerId, listing)
  )
}

export const getQuickOrderOrderTypeOptions = (
  providerId?: TradingProviderId,
  listing?: ListingInputValue
): QuickOrderOrderTypeOption[] => {
  return getQuickOrderOrderTypeDefinitions(providerId, listing).map((definition) => ({
    id: definition.id,
    label: definition.label || definition.id,
  }))
}

export const getQuickOrderOrderTypeDefinition = (
  providerId?: TradingProviderId,
  orderType?: string,
  listing?: ListingInputValue
) => {
  const requested = orderType?.trim()
  if (!requested) return null
  return (
    getQuickOrderOrderTypeDefinitions(providerId, listing).find(
      (definition) => definition.id === requested
    ) ?? null
  )
}

export const resolveQuickOrderOrderType = ({
  providerId,
  listing,
  orderType,
}: {
  providerId?: TradingProviderId
  listing?: ListingInputValue
  orderType?: string
}): QuickOrderOrderTypeResolution => {
  if (!providerId) {
    return {
      ok: false,
      reason: 'no_supported_order_types',
      options: [],
    }
  }

  const definitions = getQuickOrderOrderTypeDefinitions(providerId, listing)
  const options = definitions.map((definition) => ({
    id: definition.id,
    label: definition.label || definition.id,
  }))

  if (!definitions.length) {
    return {
      ok: false,
      reason: 'no_supported_order_types',
      options,
    }
  }

  const requested = orderType?.trim()
  if (requested) {
    const definition = definitions.find((candidate) => candidate.id === requested)
    if (!definition) {
      return {
        ok: false,
        reason: 'unsupported_order_type',
        requestedOrderType: requested,
        options,
      }
    }
    return {
      ok: true,
      definition,
      orderType: definition.id as TradingOrderType,
      options,
    }
  }

  const provider = getTradingProvider(providerId)
  const definition =
    definitions.find((definition) => definition.id === provider.defaults?.orderType) ??
    definitions[0]

  return {
    ok: true,
    definition,
    orderType: definition.id as TradingOrderType,
    options,
  }
}

export const normalizeQuickOrderNumber = (value: unknown): QuickOrderNumberParseResult => {
  if (value === null || value === undefined) return { ok: true, value: undefined }

  let parsed: number
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return { ok: true, value: undefined }
    parsed = Number(trimmed)
  } else if (typeof value === 'number') {
    parsed = value
  } else {
    return { ok: false, reason: 'invalid_number', rawValue: value }
  }

  return Number.isFinite(parsed)
    ? { ok: true, value: parsed }
    : { ok: false, reason: 'invalid_number', rawValue: value }
}
