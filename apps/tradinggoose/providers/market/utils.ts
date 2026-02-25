import { createLogger } from '@/lib/logs/console/logger'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import {
  toListingValueObject,
  type ListingInputValue,
} from '@/lib/listing/identity'
import { MarketProviderError } from '@/providers/market/errors'
import type { AssetClass } from '@/providers/market/types'
import type { ListingContext, MarketProviderConfig, MarketSymbolRule, RuleScopeKey } from './providers'

const logger = createLogger('MarketProviderUtils')

export async function resolveListingContext(listing: ListingInputValue): Promise<ListingContext> {
  const normalizedListing = toListingValueObject(listing)
  if (!normalizedListing) {
    throw new MarketProviderError({
      code: 'LISTING RESOLVE FAILED',
      message: 'listing is required',
      status: 400,
    })
  }

  let resolved: Awaited<ReturnType<typeof resolveListingIdentity>>
  try {
    resolved = await resolveListingIdentity(normalizedListing)
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? `${error.message}`
        : 'Listing resolution failed'
    throw new MarketProviderError({
      code: 'LISTING RESOLVE FAILED',
      message,
      status: 502,
      details: {
        listing: normalizedListing,
      },
    })
  }
  if (!resolved?.base) {
    throw new MarketProviderError({
      code: 'LISTING RESOLVE FAILED',
      message: 'Listing could not be resolved',
      status: 422,
      details: {
        listing: normalizedListing,
      },
    })
  }

  const assetClass =
    (resolved.assetClass ??
      (normalizedListing.listing_type === 'default'
        ? undefined
        : normalizedListing.listing_type)) as AssetClass | undefined

  return {
    listing: normalizedListing,
    base: resolved.base,
    quote: resolved.quote ?? undefined,
    assetClass,
    marketCode: resolved.marketCode ?? undefined,
    countryCode: resolved.countryCode ?? undefined,
    cityName: resolved.cityName ?? undefined,
    timeZoneName: resolved.timeZoneName ?? undefined,
  }
}

export function resolveProviderSymbol(
  config: MarketProviderConfig,
  context: ListingContext
): string {
  const marketCode = context.marketCode?.trim().toUpperCase()
  const exchangeCode = marketCode
    ? config.marketToExchangeCode[marketCode]
    : undefined
  const exchangeSuffix = exchangeCode ? `.${exchangeCode}` : ''
  const enrichedContext: ListingContext = {
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
  if (rule.market && rule.market !== context.marketCode) return false
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
  if (rule.market) score += fieldWeights.market || 0
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
      case 'exchangeCode':
        return context.exchangeCode || ''
      case 'exchangeSuffix':
        return context.exchangeSuffix || ''
      case 'country':
        return context.countryCode || ''
      case 'city':
        return context.cityName || ''
      case 'market':
        return context.marketCode || ''
      case 'assetClass':
        return context.assetClass || ''
      case 'listing':
        if (!context.listing) return ''
        if (context.listing.listing_type === 'default') {
          return context.listing.listing_id || ''
        }
        if (context.listing.base_id && context.listing.quote_id) {
          return `${context.listing.base_id}:${context.listing.quote_id}`
        }
        return ''
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
