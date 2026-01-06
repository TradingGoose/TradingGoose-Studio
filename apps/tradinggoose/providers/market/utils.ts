import { createLogger } from '@/lib/logs/console/logger'
import { marketClient } from '@/lib/market/client'
import type { AssetClass } from '@/providers/market/types'
import type { ListingContext, MarketProviderConfig, MarketSymbolRule, RuleScopeKey } from './providers'

const logger = createLogger('MarketProviderUtils')

type ListingResponse = {
  data?: any
  error?: string
}

type MicSearchRow = {
  id: string
  mic: string
  name: string | null
}

export async function resolveListingContext(listingId: string): Promise<ListingContext> {
  const listingRes = await marketClient.makeRequest<ListingResponse>(
    `/api/search/listings?listing_id=${encodeURIComponent(listingId)}`
  )

  if (!listingRes.success) {
    throw new Error(listingRes.error || 'Failed to resolve listing')
  }

  const listingPayload = listingRes.data as ListingResponse | null
  const listingData = listingPayload?.data
  const listing = Array.isArray(listingData) ? listingData[0] : listingData

  if (!listing) {
    throw new Error('Listing not found')
  }

  const primaryMicCode = listing.primaryMicCode as string | undefined
  const primaryMicName = listing.primaryMicName as string | undefined
  let micCode: string | undefined = primaryMicCode

  if (!micCode && primaryMicName) {
    const micRes = await marketClient.makeRequest<ListingResponse>(
      `/api/search/mics?mic_name=${encodeURIComponent(primaryMicName)}`
    )

    if (micRes.success) {
      const micPayload = micRes.data as ListingResponse | null
      const micRows = (micPayload?.data as MicSearchRow[]) || []
      micCode = micRows[0]?.mic
    }
  }

  return {
    listingId,
    base: listing.base as string,
    quote: listing.quote as string | undefined,
    assetClass: listing.assetClass as AssetClass | undefined,
    primaryMicCode: micCode ?? primaryMicCode,
    micCode,
    countryCode: listing.countryCode as string | undefined,
    cityName: listing.cityName as string | undefined,
    timeZoneName: listing.timeZoneName as string | undefined,
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
  if (rule.listingId && rule.listingId !== context.listingId) return false
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
  if (rule.listingId) score += fieldWeights.listing || 0
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
      case 'listingId':
        return context.listingId
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
