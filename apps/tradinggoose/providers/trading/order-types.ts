import type { ListingInputValue } from '@/lib/listing/identity'
import type { AssetClass } from '@/providers/market/types'
import { getTradingProviderConfig } from '@/providers/trading/providers'
import type { TradingOrderTypeDefinition } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'

const ASSET_CLASS_SET = new Set<AssetClass>([
  'stock',
  'etf',
  'future',
  'currency',
  'crypto',
  'indice',
  'mutualfund',
])

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

const resolveAssetClass = (listing?: ListingInputValue): AssetClass | undefined => {
  if (!listing || typeof listing === 'string') return undefined
  const record = listing as Record<string, unknown>

  const direct = record.assetClass ?? record.base_asset_class ?? record.quote_asset_class
  if (typeof direct === 'string' && ASSET_CLASS_SET.has(direct as AssetClass)) {
    return direct as AssetClass
  }

  const listingType = typeof record.listing_type === 'string' ? record.listing_type : undefined
  if (listingType === 'crypto' || listingType === 'currency') {
    return listingType as AssetClass
  }
  if (listingType === 'equity') {
    return 'stock'
  }

  return undefined
}

const normalizeOrderTypeDefinitions = (
  orderTypes?: TradingOrderTypeDefinition[]
): TradingOrderTypeDefinition[] => {
  if (!orderTypes?.length) return []
  return orderTypes
}

export function getTradingOrderTypeOptions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderClass?: string
  } = {}
): Array<{ id: string; label: string }> {
  if (!providerId) return []

  const config = getTradingProviderConfig(providerId)
  const definitions = normalizeOrderTypeDefinitions(config?.capabilities?.order?.orderTypes)
  if (!definitions.length) return []

  const assetClass = resolveAssetClass(context.listing)
  const normalizedOrderClass =
    normalizeOrderClass(context.orderClass) ?? (providerId === 'tradier' ? 'equity' : undefined)

  const filtered = definitions.filter((definition) => {
    if (assetClass && definition.assetClasses?.length) {
      if (!definition.assetClasses.includes(assetClass)) return false
    }
    if (normalizedOrderClass && definition.orderClasses?.length) {
      if (!definition.orderClasses.includes(normalizedOrderClass)) return false
    }
    return true
  })

  const resultSource = filtered.length ? filtered : definitions
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
