import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import { resolveListingKey, toListingValueObject } from '@/lib/listing/identity'
import type { AssetClass } from '@/providers/market/types'
import type {
  TradingProviderConfig,
  TradingRuleScopeKey,
  TradingSymbolRule,
} from '@/providers/trading/providers'
import type { TradingSymbolInput } from '@/providers/trading/types'

const readListingField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return String(value)
  }
  return undefined
}

export interface TradingListingContext {
  listingKey: string
  listing?: ListingIdentity | null
  base: string
  quote?: string
  assetClass?: AssetClass
  marketCode?: string
  exchangeCode?: string
  exchangeSuffix?: string
  countryCode?: string
  cityName?: string
  timeZoneName?: string
}

export function resolveTradingListingContext(input: TradingSymbolInput): TradingListingContext {
  const listingValue = input.listing as ListingInputValue | undefined
  const record = (listingValue || {}) as Record<string, unknown>

  const listingKeyFromListing = resolveListingKey(listingValue)

  const base =
    input.base ||
    readListingField(record, 'base') ||
    (listingKeyFromListing?.includes(':')
      ? listingKeyFromListing.split(':')[0]
      : listingKeyFromListing)

  if (!base) {
    throw new Error('listing base is required')
  }

  const quote =
    input.quote ||
    readListingField(record, 'quote') ||
    (listingKeyFromListing?.includes(':') ? listingKeyFromListing.split(':')[1] : undefined)

  const listingKey = listingKeyFromListing || (quote ? `${base}:${quote}` : base)

  const assetClass =
    input.assetClass || (readListingField(record, 'assetClass') as AssetClass | undefined)

  const marketCode = readListingField(record, 'marketCode') || input.marketCode
  const countryCode = readListingField(record, 'countryCode') || input.countryCode
  const cityName = readListingField(record, 'cityName') || input.cityName
  const timeZoneName = readListingField(record, 'timeZoneName') || input.timeZoneName

  return {
    listingKey,
    listing: toListingValueObject(listingValue ?? listingKey),
    base,
    quote: quote ?? undefined,
    assetClass: assetClass ?? undefined,
    marketCode: marketCode ?? undefined,
    countryCode: countryCode ?? undefined,
    cityName: cityName ?? undefined,
    timeZoneName: timeZoneName ?? undefined,
  }
}

export function resolveTradingSymbol(
  config: TradingProviderConfig,
  input: TradingSymbolInput
): string {
  const context = resolveTradingListingContext(input)
  return resolveTradingProviderSymbol(config, context)
}

export function resolveTradingProviderSymbol(
  config: TradingProviderConfig,
  context: TradingListingContext
): string {
  const marketCode = context.marketCode?.trim().toUpperCase()
  const exchangeCode = marketCode ? config.marketToExchangeCode[marketCode] : undefined
  const exchangeSuffix = exchangeCode ? `.${exchangeCode}` : ''
  const enrichedContext: TradingListingContext = {
    ...context,
    marketCode,
    exchangeCode,
    exchangeSuffix,
  }

  const precedence =
    config.rulePrecedence[context.assetClass ?? 'default'] || config.rulePrecedence.default || []

  const activeRules = config.rules.filter((rule) => rule.active !== false)
  const matchedRules = activeRules.filter((rule) => matchesRule(rule, enrichedContext))

  if (!matchedRules.length) {
    return buildFallbackSymbol(enrichedContext)
  }

  const ranked = matchedRules
    .map((rule) => ({ rule, score: scoreRule(rule, precedence) }))
    .sort((a, b) => b.score - a.score)

  const selected = ranked[0]?.rule
  if (!selected) {
    return buildFallbackSymbol(enrichedContext)
  }

  const symbol = renderTemplate(selected.template, enrichedContext)
  return symbol || buildFallbackSymbol(enrichedContext)
}

function matchesRule(rule: TradingSymbolRule, context: TradingListingContext): boolean {
  if (rule.assetClass && rule.assetClass !== context.assetClass) return false
  if (rule.listingKey && rule.listingKey !== context.listingKey) return false
  if (rule.market && rule.market !== context.marketCode) return false
  if (rule.country && rule.country !== context.countryCode) return false
  if (rule.city && rule.city !== context.cityName) return false
  if (rule.currency && rule.currency !== context.quote) return false

  if (rule.regex) {
    const source = getRuleSourceSymbol(context)
    try {
      const re = new RegExp(rule.regex)
      if (!re.test(source)) return false
    } catch {
      return false
    }
  }

  return true
}

function scoreRule(rule: TradingSymbolRule, precedence: TradingRuleScopeKey[]): number {
  const fieldWeights: Record<TradingRuleScopeKey, number> = {
    listing: 0,
    market: 0,
    currency: 0,
    assetClass: 0,
    country: 0,
    city: 0,
  }

  const length = precedence.length
  precedence.forEach((key, index) => {
    fieldWeights[key] = length - index
  })

  let score = 0
  if (rule.listingKey) score += fieldWeights.listing || 0
  if (rule.market) score += fieldWeights.market || 0
  if (rule.currency) score += fieldWeights.currency || 0
  if (rule.assetClass) score += fieldWeights.assetClass || 0
  if (rule.country) score += fieldWeights.country || 0
  if (rule.city) score += fieldWeights.city || 0

  if (rule.regex) score += 0.5

  return score
}

function getRuleSourceSymbol(context: TradingListingContext): string {
  if (context.assetClass === 'currency') {
    return `${context.base}${context.quote ?? ''}`
  }
  if (context.assetClass === 'crypto') {
    return context.quote ? `${context.base}-${context.quote}` : context.base
  }
  return context.base
}

function renderTemplate(template: string, context: TradingListingContext): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    switch (key) {
      case 'base':
        return context.base
      case 'quote':
        return context.quote || ''
      case 'market':
        return context.marketCode || ''
      case 'exchangeCode':
        return context.exchangeCode || ''
      case 'exchangeSuffix':
        return context.exchangeSuffix || ''
      case 'country':
        return context.countryCode || ''
      case 'city':
        return context.cityName || ''
      case 'assetClass':
        return context.assetClass || ''
      case 'listing':
        return context.listingKey
      default:
        return ''
    }
  })
}

function buildFallbackSymbol(context: TradingListingContext): string {
  if (context.assetClass === 'currency') {
    return context.quote ? `${context.base}${context.quote}=X` : context.base
  }
  if (context.assetClass === 'crypto') {
    return context.quote ? `${context.base}-${context.quote}` : context.base
  }
  if (context.exchangeSuffix) {
    return `${context.base}${context.exchangeSuffix}`
  }
  return context.base
}
