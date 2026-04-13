import type { ListingIdentity, ListingInputValue, ListingType } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
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

interface TradingListingContext {
  listing?: ListingIdentity | null
  base: string
  quote?: string
  assetClass?: AssetClass
  marketCode?: string
  exchangeCode?: string
  exchangeSuffix?: string
  countryCode?: string
  cityName?: string
}

export interface TradingSymbolToListingIdentityInput {
  symbol?: string | null
  assetClass?: AssetClass | null
  defaultQuote?: string
}

export interface TradingSymbolToListingIdentityResult {
  listing: ListingIdentity
  base: string
  quote: string
  assetClass: AssetClass
}

function buildTradingListingContext(input: TradingSymbolInput): TradingListingContext {
  const listingValue = input.listing as ListingInputValue | undefined
  const record = (listingValue || {}) as Record<string, unknown>

  const listingIdentity = toListingValueObject(listingValue)

  const base =
    input.base ||
    readListingField(record, 'base') ||
    (listingIdentity?.listing_type === 'default'
      ? listingIdentity.listing_id || undefined
      : listingIdentity?.base_id || undefined)

  if (!base) {
    throw new Error('listing base is required')
  }

  const quote =
    input.quote ||
    readListingField(record, 'quote') ||
    (listingIdentity && listingIdentity.listing_type !== 'default'
      ? listingIdentity.quote_id || undefined
      : undefined)

  const assetClass =
    input.assetClass ||
    (readListingField(record, 'assetClass') as AssetClass | undefined) ||
    inferAssetClassFromListing(listingIdentity)

  const marketCode = readListingField(record, 'marketCode') || input.marketCode
  const countryCode = readListingField(record, 'countryCode') || input.countryCode
  const cityName = readListingField(record, 'cityName') || input.cityName

  return {
    listing: listingIdentity,
    base,
    quote: quote ?? undefined,
    assetClass: assetClass ?? undefined,
    marketCode: marketCode ?? undefined,
    countryCode: countryCode ?? undefined,
    cityName: cityName ?? undefined,
  }
}

export function listingIdentityToTradingSymbol(
  config: TradingProviderConfig,
  input: TradingSymbolInput
): string {
  const context = buildTradingListingContext(input)
  return renderTradingProviderSymbol(config, context)
}

export function tradingSymbolToListingIdentity(
  config: TradingProviderConfig,
  input: TradingSymbolToListingIdentityInput
): TradingSymbolToListingIdentityResult | null {
  const symbol = normalizeTradingProviderSymbol(input.symbol)
  if (!symbol) return null

  const fallbackAssetClass = input.assetClass ?? config.availability.assetClass[0] ?? 'stock'
  const defaultQuote = normalizeTradingProviderSymbol(input.defaultQuote) ?? 'USD'

  const matchedRule = config.rules
    .filter((rule) => rule.active !== false)
    .filter((rule) => !input.assetClass || !rule.assetClass || rule.assetClass === input.assetClass)
    .map((rule, index) => ({
      rule,
      index,
      parsed: parseSymbolWithTemplate(symbol, rule.template),
    }))
    .filter(
      (
        candidate
      ): candidate is {
        rule: TradingSymbolRule
        index: number
        parsed: Record<string, string>
      } => candidate.parsed !== null
    )
    .sort((left, right) => {
      const scoreDelta =
        scoreReverseRule(right.rule, input.assetClass) - scoreReverseRule(left.rule, input.assetClass)
      return scoreDelta !== 0 ? scoreDelta : left.index - right.index
    })[0]?.rule

  const parsed = matchedRule
    ? parseSymbolWithTemplate(symbol, matchedRule.template)
    : parseDefaultTradingSymbol(symbol)
  if (!parsed) return null

  const assetClass = matchedRule?.assetClass ?? input.assetClass ?? fallbackAssetClass
  const listingType = toListingType(assetClass)
  const base = normalizeTradingProviderSymbol(parsed.base ?? parsed.listing)
  const quote =
    normalizeTradingProviderSymbol(parsed.quote) ??
    normalizeTradingProviderSymbol(matchedRule?.currency) ??
    defaultQuote

  if (!base) return null

  if (listingType === 'default') {
    return {
      listing: {
        listing_id: base,
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      base,
      quote,
      assetClass,
    }
  }

  if (!quote) return null

  return {
    listing: {
      listing_id: '',
      base_id: base,
      quote_id: quote,
      listing_type: listingType,
    },
    base,
    quote,
    assetClass,
  }
}

function renderTradingProviderSymbol(
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
    .map((rule) => ({ rule, score: scoreRule(rule, precedence, enrichedContext.assetClass) }))
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

function scoreRule(
  rule: TradingSymbolRule,
  precedence: TradingRuleScopeKey[],
  assetClass?: AssetClass
): number {
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
  if (rule.market) score += fieldWeights.market || 0
  if (rule.currency) score += fieldWeights.currency || 0
  if (rule.assetClass) score += fieldWeights.assetClass || 0
  if (rule.country) score += fieldWeights.country || 0
  if (rule.city) score += fieldWeights.city || 0

  if (rule.assetClass && assetClass && rule.assetClass === assetClass && !fieldWeights.assetClass) {
    score += length + 0.5
  }

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
        if (context.listing?.listing_type === 'default') {
          return context.listing.listing_id || ''
        }
        if (context.listing?.base_id && context.listing?.quote_id) {
          return `${context.listing.base_id}:${context.listing.quote_id}`
        }
        return context.quote ? `${context.base}:${context.quote}` : context.base
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

function normalizeTradingProviderSymbol(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function scoreReverseRule(rule: TradingSymbolRule, assetClass?: AssetClass | null): number {
  let score = 0
  if (rule.assetClass) score += 8
  if (assetClass && rule.assetClass === assetClass) score += 4
  if (rule.currency) score += 3
  if (rule.market) score += 2
  if (rule.country) score += 2
  if (rule.city) score += 2
  score += rule.template.length / 100
  return score
}

function parseSymbolWithTemplate(
  symbol: string,
  template: string
): Record<string, string> | null {
  const pattern = buildTemplateRegex(template)
  if (!pattern) return null
  const match = pattern.exec(symbol)
  if (!match) return null

  const groups = match.groups ?? {}
  const parsed = Object.fromEntries(
    Object.entries(groups)
      .map(([key, value]) => [key, value?.trim() ?? ''])
      .filter(([, value]) => value.length > 0)
  )
  return Object.keys(parsed).length > 0 ? parsed : null
}

function buildTemplateRegex(template: string): RegExp | null {
  const matches = Array.from(template.matchAll(/\{(\w+)\}/g))
  if (matches.length === 0) return null

  let lastIndex = 0
  const parts: string[] = ['^']

  for (const match of matches) {
    const full = match[0]
    const key = match[1]
    const start = match.index ?? 0
    parts.push(escapeRegex(template.slice(lastIndex, start)))
    parts.push(resolveTemplateCapture(key))
    lastIndex = start + full.length
  }

  parts.push(escapeRegex(template.slice(lastIndex)))
  parts.push('$')

  return new RegExp(parts.join(''))
}

function resolveTemplateCapture(key: string): string {
  switch (key) {
    case 'exchangeSuffix':
      return '(?<exchangeSuffix>\\.[A-Za-z0-9._-]+)'
    case 'exchangeCode':
      return '(?<exchangeCode>[A-Za-z0-9._-]+)'
    case 'base':
    case 'quote':
    case 'listing':
    case 'market':
    case 'country':
    case 'city':
    case 'assetClass':
    default:
      return `(?<${key}>[A-Za-z0-9._:-]+)`
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseDefaultTradingSymbol(symbol: string): Record<string, string> {
  if (symbol.includes('/')) {
    const [base, quote] = symbol.split('/')
    return {
      base: base?.trim() ?? '',
      quote: quote?.trim() ?? '',
    }
  }

  return {
    base: symbol,
  }
}

function toListingType(assetClass?: AssetClass | null): ListingType {
  if (assetClass === 'crypto') return 'crypto'
  if (assetClass === 'currency') return 'currency'
  return 'default'
}

function inferAssetClassFromListing(listing?: ListingIdentity | null): AssetClass | undefined {
  if (listing?.listing_type === 'crypto') return 'crypto'
  if (listing?.listing_type === 'currency') return 'currency'
  return undefined
}
