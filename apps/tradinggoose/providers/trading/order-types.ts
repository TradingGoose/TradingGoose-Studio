import type { ListingInputValue } from '@/lib/listing/identity'
import type { TradingOrderTypeDefinition } from '@/providers/trading/providers'
import { getTradingProviderConfig } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import { resolveTradingListingAssetClass } from '@/providers/trading/utils'

const toTitleCase = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const normalizeOrderClass = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  return trimmed ? trimmed : undefined
}

const normalizeOrderTypeDefinitions = (
  orderTypes?: TradingOrderTypeDefinition[]
): TradingOrderTypeDefinition[] => {
  if (!orderTypes?.length) return []
  return orderTypes
}

export function getStrictTradingOrderTypeDefinitions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderClass?: string
  } = {}
): TradingOrderTypeDefinition[] {
  if (!providerId) return []

  const config = getTradingProviderConfig(providerId)
  if (!config) return []
  const definitions = normalizeOrderTypeDefinitions(config?.capabilities?.order?.orderTypes)
  if (!definitions.length) return []

  const assetClass = resolveTradingListingAssetClass(context.listing)
  if (
    assetClass &&
    config.availability.assetClass.length > 0 &&
    !config.availability.assetClass.includes(assetClass)
  ) {
    return []
  }

  const normalizedOrderClass =
    normalizeOrderClass(context.orderClass) ?? (providerId === 'tradier' ? 'equity' : undefined)

  return definitions.filter((definition) => {
    if (assetClass && definition.assetClasses?.length) {
      if (!definition.assetClasses.includes(assetClass)) return false
    }
    if (normalizedOrderClass && definition.orderClasses?.length) {
      if (!definition.orderClasses.includes(normalizedOrderClass)) return false
    }
    return true
  })
}

export function getTradingOrderTypeDefinitions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderClass?: string
  } = {}
): TradingOrderTypeDefinition[] {
  if (!providerId) return []

  const config = getTradingProviderConfig(providerId)
  const definitions = normalizeOrderTypeDefinitions(config?.capabilities?.order?.orderTypes)
  if (!definitions.length) return []

  const filtered = getStrictTradingOrderTypeDefinitions(providerId, context)
  return filtered.length ? filtered : definitions
}

export function getTradingOrderTypeOptions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderClass?: string
  } = {}
): Array<{ id: string; label: string }> {
  const resultSource = getTradingOrderTypeDefinitions(providerId, context)
  if (!resultSource.length) return []

  const seen = new Set<string>()

  return resultSource.reduce<Array<{ id: string; label: string }>>((acc, definition) => {
    if (seen.has(definition.id)) return acc
    seen.add(definition.id)
    acc.push({
      id: definition.id,
      label: definition.label || toTitleCase(definition.id),
    })
    return acc
  }, [])
}
