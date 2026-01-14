import { createLogger } from '@/lib/logs/console/logger'
import { resolveListingKey, toListingValueObject, type ListingIdentity } from '@/lib/market/listings'
import type { AssetClass } from '@/providers/market/types'
import type { ListingContext, MarketProviderConfig, MarketSymbolRule, RuleScopeKey } from './providers'

const logger = createLogger('MarketProviderUtils')

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

export async function resolveListingContext(listing: ListingIdentity): Promise<ListingContext> {
  const listingKey = resolveListingKey(listing)
  if (!listingKey) {
    throw new Error('listing is required')
  }

  const record = listing as Record<string, unknown>
  const base = readListingField(record, 'base')
  if (!base) {
    throw new Error('listing base is required')
  }
  const quote = readListingField(record, 'quote')
  const assetClass = readListingField(record, 'assetClass') as AssetClass | undefined
  const primaryMicCode = readListingField(record, 'primaryMicCode')
  const micCode = readListingField(record, 'micCode') ?? primaryMicCode
  const countryCode = readListingField(record, 'countryCode')
  const cityName = readListingField(record, 'cityName')
  const timeZoneName = readListingField(record, 'timeZoneName')

  return {
    listingKey,
    listing: toListingValueObject(listing),
    base,
    quote: quote ?? undefined,
    assetClass,
    primaryMicCode: primaryMicCode ?? micCode ?? undefined,
    micCode,
    countryCode: countryCode ?? undefined,
    cityName: cityName ?? undefined,
    timeZoneName: timeZoneName ?? undefined,
  }
}

export function resolveProviderSymbol(
  config: MarketProviderConfig,
  context: ListingContext
): string {
  const exchangeCode = context.micCode ? config.micToExchangeCode[context.micCode] : undefined
  const exchangeSuffix = exchangeCode ? `.${exchangeCode}` : ''
  const enrichedContext: ListingContext = {
    ...context,
    exchangeCode,
    exchangeSuffix,
  }

  const precedence =
    config.rulePrecedence[context.assetClass ?? 'default'] || config.rulePrecedence.default || []

  const activeRules = config.rules.filter((rule) => rule.active !== false)
  const matchedRules = activeRules.filter((rule) => matchesRule(rule, enrichedContext))

  if (!matchedRules.length) {
    return buildFallbackSymbol(context)
  }

  const ranked = matchedRules
    .map((rule) => ({ rule, score: scoreRule(rule, precedence) }))
    .sort((a, b) => b.score - a.score)

  const selected = ranked[0]?.rule
  if (!selected) {
    return buildFallbackSymbol(context)
  }

  const symbol = renderTemplate(selected.template, enrichedContext)
  return symbol || buildFallbackSymbol(enrichedContext)
}

function matchesRule(rule: MarketSymbolRule, context: ListingContext): boolean {
  if (rule.assetClass && rule.assetClass !== context.assetClass) return false
  if (rule.listingKey && rule.listingKey !== context.listingKey) return false
  if (rule.mic && rule.mic !== context.micCode) return false
  if (rule.country && rule.country !== context.countryCode) return false
  if (rule.city && rule.city !== context.cityName) return false
  if (rule.currency && rule.currency !== context.quote) return false

  if (rule.regex) {
    const source = getRuleSourceSymbol(context)
    try {
      const re = new RegExp(rule.regex)
      if (!re.test(source)) return false
    } catch (error) {
      logger.warn('Invalid rule regex', { regex: rule.regex, error })
      return false
    }
  }

  return true
}

function scoreRule(rule: MarketSymbolRule, precedence: RuleScopeKey[]): number {
  const fieldWeights: Record<RuleScopeKey, number> = {
    listing: 0,
    mic: 0,
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
  if (rule.mic) score += fieldWeights.mic || 0
  if (rule.currency) score += fieldWeights.currency || 0
  if (rule.assetClass) score += fieldWeights.assetClass || 0
  if (rule.country) score += fieldWeights.country || 0
  if (rule.city) score += fieldWeights.city || 0

  // Prefer regex-specific rules when other scores tie
  if (rule.regex) score += 0.5

  return score
}

function getRuleSourceSymbol(context: ListingContext): string {
  if (context.assetClass === 'currency') {
    return `${context.base}${context.quote ?? ''}`
  }
  if (context.assetClass === 'crypto') {
    return context.quote ? `${context.base}-${context.quote}` : context.base
  }
  return context.base
}

function renderTemplate(template: string, context: ListingContext): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    switch (key) {
      case 'base':
        return context.base
      case 'quote':
        return context.quote || ''
      case 'mic':
        return context.micCode || ''
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

function buildFallbackSymbol(context: ListingContext): string {
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
