import { createLogger } from '@/lib/logs/console/logger'
import type { MarketNewsRequest, NewsItem, NewsSeries } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'

const logger = createLogger('MarketProvider:Finnhub:News')

function toDateString(value: string | number): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 1e12 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10)
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10)
    }
  }

  return undefined
}

function resolveDateRange(request: MarketNewsRequest): { from: string; to: string } {
  const now = new Date()
  const explicitFrom = request.start ? toDateString(request.start) : undefined
  const explicitTo = request.end ? toDateString(request.end) : undefined

  if (explicitFrom && explicitTo) {
    return { from: explicitFrom, to: explicitTo }
  }

  const toDate = explicitTo ? new Date(explicitTo) : now

  const fallbackFrom = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    from: explicitFrom || fallbackFrom.toISOString().slice(0, 10),
    to: explicitTo || toDate.toISOString().slice(0, 10),
  }
}

function normalizeNewsItem(item: Record<string, any>, symbol?: string): NewsItem | null {
  const headline =
    (typeof item.headline === 'string' && item.headline.trim()) ||
    (typeof item.title === 'string' && item.title.trim()) ||
    undefined

  if (!headline) return null

  const timestampValue = item.datetime ?? item.time ?? item.timestamp ?? item.publishedAt
  let timeStamp: string | undefined

  if (typeof timestampValue === 'number' && Number.isFinite(timestampValue)) {
    const ms = timestampValue > 1e12 ? timestampValue : timestampValue * 1000
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) {
      timeStamp = date.toISOString()
    }
  } else if (typeof timestampValue === 'string') {
    const date = new Date(timestampValue)
    if (!Number.isNaN(date.getTime())) {
      timeStamp = date.toISOString()
    }
  }

  if (!timeStamp) return null

  return {
    timeStamp,
    title: headline,
    url: typeof item.url === 'string' ? item.url : undefined,
    source: typeof item.source === 'string' ? item.source : undefined,
    symbols: symbol ? [symbol] : undefined,
  }
}

export async function fetchFinnhubNews(
  request: MarketNewsRequest
): Promise<NewsSeries> {
  if (!request.listingId) {
    throw new Error('listingId is required')
  }

  const context = await resolveListingContext(request.listingId)
  const symbol = resolveProviderSymbol(finnhubProviderConfig, context)

  const apiKey =
    (request.providerParams?.apiKey as string | undefined) || process.env.FINNHUB_API_KEY

  if (!apiKey) {
    throw new Error('Finnhub API key is required')
  }

  const { from, to } = resolveDateRange(request)
  const url = new URL('https://finnhub.io/api/v1/company-news')
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('from', from)
  url.searchParams.set('to', to)

  logger.info('Fetching Finnhub company news', {
    listingId: request.listingId,
    symbol,
    from,
    to,
  })

  const response = await fetch(url.toString(), {
    headers: {
      'X-Finnhub-Token': apiKey,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Finnhub request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as Array<Record<string, any>>
  if (!Array.isArray(payload)) {
    throw new Error('Unexpected Finnhub news response')
  }

  const items = payload
    .map((entry) => normalizeNewsItem(entry, symbol))
    .filter((item): item is NewsItem => Boolean(item))

  return { items }
}
