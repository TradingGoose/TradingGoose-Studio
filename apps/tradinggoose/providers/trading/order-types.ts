import type { ListingInputValue } from '@/lib/listing/identity'
import type { TradingOrderTypeDefinition } from '@/providers/trading/providers'
import { getTradingProviderConfig } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import { resolveTradingListingAssetClass } from '@/providers/trading/utils'

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
  const definitions = config.capabilities?.order?.orderTypes ?? []
  if (!definitions.length) return []

  const assetClass = resolveTradingListingAssetClass(context.listing)
  if (
    assetClass &&
    config.availability.assetClass.length > 0 &&
    !config.availability.assetClass.includes(assetClass)
  ) {
    return []
  }
  const orderClass =
    typeof context.orderClass === 'string' && context.orderClass.trim()
      ? context.orderClass.trim().toLowerCase()
      : providerId === 'tradier'
        ? 'equity'
        : undefined

  return definitions.filter((definition) => {
    if (assetClass && definition.assetClasses?.length) {
      if (!definition.assetClasses.includes(assetClass)) return false
    }
    if (orderClass && definition.orderClasses?.length) {
      if (!definition.orderClasses.includes(orderClass)) return false
    }
    return true
  })
}

export function getTradingOrderTypeOptions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderClass?: string
  } = {}
): Array<{ id: string; label: string }> {
  const resultSource = getStrictTradingOrderTypeDefinitions(providerId, context)
  if (!resultSource.length) return []

  const seen = new Set<string>()

  return resultSource.reduce<Array<{ id: string; label: string }>>((acc, definition) => {
    if (seen.has(definition.id)) return acc
    seen.add(definition.id)
    acc.push({
      id: definition.id,
      label: definition.label,
    })
    return acc
  }, [])
}
