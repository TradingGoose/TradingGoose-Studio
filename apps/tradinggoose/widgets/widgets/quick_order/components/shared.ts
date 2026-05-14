import type { ListingInputValue } from '@/lib/listing/identity'
import {
  getStrictTradingOrderTypeDefinitions,
  getTradingOrderSizingModeDefinitions,
  resolveTradingOrderSizingMode,
  resolveTradingOrderTypeDefinition,
} from '@/providers/trading/order-types'
import type {
  TradingOrderSizingModeDefinition,
  TradingOrderTypeDefinition,
} from '@/providers/trading/providers'
import type {
  TradingOrderSizingMode,
  TradingOrderType,
  TradingProviderId,
} from '@/providers/trading/types'
import { resolveTradingListingAssetClass } from '@/providers/trading/utils'
import {
  getTradingWidgetProviderAvailabilityIds,
  getTradingWidgetProviderOptions,
  resolveTradingWidgetProviderId,
} from '@/widgets/utils/trading-widget-providers'
import {
  getSeriesMarketProviderOptions,
  resolveConfiguredSeriesMarketProviderId,
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

export const getQuickOrderMarketProviderOptions = () => getSeriesMarketProviderOptions()

export const resolveQuickOrderMarketProviderId = (
  params: QuickOrderWidgetParams | null | undefined,
  options = getQuickOrderMarketProviderOptions()
) => resolveConfiguredSeriesMarketProviderId(params?.marketProvider, options)

export type QuickOrderSizingModeConfig = {
  options: TradingOrderSizingMode[]
  definitions: TradingOrderSizingModeDefinition[]
  defaultMode?: TradingOrderSizingMode
}

export const getQuickOrderSizingModeConfig = (providerId?: string): QuickOrderSizingModeConfig => {
  if (!providerId) return { options: [], definitions: [] }
  const definitions = getTradingOrderSizingModeDefinitions(providerId)
  const options = definitions.map((definition) => definition.id)
  const defaultMode = resolveTradingOrderSizingMode(providerId)

  return { options, definitions, defaultMode }
}

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
  return getStrictTradingOrderTypeDefinitions(providerId, { listing })
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
    label: definition.label,
  }))

  if (!definitions.length) {
    return {
      ok: false,
      reason: 'no_supported_order_types',
      options,
    }
  }

  const definition = resolveTradingOrderTypeDefinition(providerId, {
    listing,
    orderType,
  })
  if (!definition) {
    const requested = orderType?.trim()
    return {
      ok: false,
      reason: requested ? 'unsupported_order_type' : 'no_supported_order_types',
      requestedOrderType: requested || undefined,
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
