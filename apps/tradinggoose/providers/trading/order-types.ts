import type { ListingInputValue } from '@/lib/listing/identity'
import type { TradingOrderTypeDefinition } from '@/providers/trading/providers'
import { getTradingProviderConfig } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import { resolveTradingListingAssetClass } from '@/providers/trading/utils'

export function getStrictTradingOrderTypeDefinitions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
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

  return definitions.filter((definition) => {
    if (assetClass && definition.assetClasses?.length) {
      if (!definition.assetClasses.includes(assetClass)) return false
    }
    return true
  })
}

export function getTradingOrderTypeOptions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
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
