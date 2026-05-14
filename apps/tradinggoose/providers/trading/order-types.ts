import type { ListingInputValue } from '@/lib/listing/identity'
import type {
  TradingOrderMethodDefinition,
  TradingOrderSizingModeDefinition,
  TradingOrderTypeDefinition,
  TradingOrderTypeRequirement,
} from '@/providers/trading/providers'
import {
  getTradingOrderCapabilities,
  getTradingProviderDefinition,
} from '@/providers/trading/providers'
import type { TradingOrderSizingMode, TradingProviderId } from '@/providers/trading/types'
import { resolveTradingListingAssetClass } from '@/providers/trading/utils'

export function getStrictTradingOrderTypeDefinitions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderMethod?: string
  } = {}
): TradingOrderTypeDefinition[] {
  if (!providerId) return []

  const provider = getTradingProviderDefinition(providerId)
  const config = provider?.config
  if (!config) return []
  const definitions = getTradingOrderCapabilities(providerId)?.orderTypes ?? []
  if (!definitions.length) return []

  const assetClass = resolveTradingListingAssetClass(context.listing)
  if (
    assetClass &&
    config.availability.assetClass.length > 0 &&
    !config.availability.assetClass.includes(assetClass)
  ) {
    return []
  }
  const orderMethod = resolveTradingOrderMethod(providerId, context)

  return definitions.filter((definition) => {
    if (assetClass && definition.assetClasses?.length) {
      if (!definition.assetClasses.includes(assetClass)) return false
    }
    if (orderMethod && definition.orderMethods?.length) {
      if (!definition.orderMethods.includes(orderMethod)) return false
    }
    return true
  })
}

export const tradingOrderTypeUsesField = (
  definition: TradingOrderTypeDefinition | null | undefined,
  field: TradingOrderTypeRequirement
): boolean =>
  Boolean(definition?.requires?.includes(field) || definition?.requiresOneOf?.includes(field))

export function getTradingOrderMethodDefinitions(
  providerId?: TradingProviderId,
  context: { listing?: ListingInputValue } = {}
): TradingOrderMethodDefinition[] {
  if (!providerId) return []

  const definitions = getTradingOrderCapabilities(providerId)?.orderMethods ?? []
  if (!definitions.length) return []

  const assetClass = resolveTradingListingAssetClass(context.listing)
  return definitions.filter((definition) => {
    if (assetClass && definition.assetClasses?.length) {
      return definition.assetClasses.includes(assetClass)
    }
    return true
  })
}

export function resolveTradingOrderMethod(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderMethod?: string
  } = {}
): string | undefined {
  if (!providerId) return undefined

  const definitions = getTradingOrderMethodDefinitions(providerId, context)
  if (!definitions.length) return undefined

  const requested = context.orderMethod?.trim()
  if (requested) {
    return definitions.some((definition) => definition.id === requested) ? requested : undefined
  }

  const defaultMethod = getTradingProviderDefinition(providerId)?.defaults?.orderMethod
  return definitions.find((definition) => definition.id === defaultMethod)?.id ?? definitions[0]?.id
}

export function getTradingOrderMethodDefinition(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderMethod?: string
  } = {}
): TradingOrderMethodDefinition | undefined {
  const orderMethod = resolveTradingOrderMethod(providerId, context)
  if (!orderMethod) return undefined
  return getTradingOrderMethodDefinitions(providerId, context).find(
    (definition) => definition.id === orderMethod
  )
}

export function getTradingOrderSizingModeDefinitions(
  providerId?: TradingProviderId
): TradingOrderSizingModeDefinition[] {
  return getTradingOrderCapabilities(providerId)?.sizingModes ?? []
}

export function resolveTradingOrderSizingMode(
  providerId?: TradingProviderId,
  requested?: string | null
): TradingOrderSizingMode | undefined {
  if (!providerId) return undefined
  const definitions = getTradingOrderSizingModeDefinitions(providerId)
  if (!definitions.length) return undefined

  const requestedMode = requested?.trim()
  if (requestedMode) {
    return definitions.some((definition) => definition.id === requestedMode)
      ? (requestedMode as TradingOrderSizingMode)
      : undefined
  }

  const defaultMode = getTradingProviderDefinition(providerId)?.defaults?.orderSizingMode
  return definitions.find((definition) => definition.id === defaultMode)?.id ?? definitions[0]?.id
}

export function getTradingOrderSizingModeDefinition(
  providerId?: TradingProviderId,
  requested?: string | null
): TradingOrderSizingModeDefinition | undefined {
  const sizingMode = resolveTradingOrderSizingMode(providerId, requested)
  return getTradingOrderSizingModeDefinitions(providerId).find(
    (definition) => definition.id === sizingMode
  )
}

export function getTradingOrderTimeInForceOptions(providerId?: TradingProviderId): string[] {
  return getTradingOrderCapabilities(providerId)?.timeInForce ?? []
}

export function resolveTradingOrderTimeInForce(
  providerId?: TradingProviderId,
  requested?: string | null
): string | undefined {
  if (!providerId) return undefined
  const options = getTradingOrderTimeInForceOptions(providerId)
  if (!options.length) return undefined

  const requestedValue = requested?.trim()
  if (requestedValue) {
    return options.includes(requestedValue) ? requestedValue : undefined
  }

  const defaultValue = getTradingProviderDefinition(providerId)?.defaults?.timeInForce
  return options.find((option) => option === defaultValue) ?? options[0]
}

export function resolveTradingOrderTypeDefinition(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderMethod?: string
    orderType?: string
  } = {}
): TradingOrderTypeDefinition | undefined {
  const definitions = getStrictTradingOrderTypeDefinitions(providerId, context)
  const requested = context.orderType?.trim()
  if (requested) return definitions.find((definition) => definition.id === requested)

  const defaultType = providerId
    ? getTradingProviderDefinition(providerId)?.defaults?.orderType
    : undefined
  return definitions.find((definition) => definition.id === defaultType) ?? definitions[0]
}

export function getTradingOrderTypeOptions(
  providerId?: TradingProviderId,
  context: {
    listing?: ListingInputValue
    orderMethod?: string
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
