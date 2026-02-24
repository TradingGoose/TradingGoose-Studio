import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import {
  type ListingIdentity,
  type ListingInputValue,
  toListingValueObject,
} from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { MARKET_API_URL_DEFAULT, MARKET_API_VERSION } from '@/lib/market/client/constants'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { parseWatchlistImportText, splitExchangeSymbol } from '@/lib/watchlists/import-export'
import { appendListingsToWatchlist, WatchlistOperationError } from '@/lib/watchlists/operations'

const logger = createLogger('WatchlistImportAPI')
const MARKET_API_URL = env.MARKET_API_URL || MARKET_API_URL_DEFAULT

const WatchlistImportSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  content: z.string().min(1, 'content is required'),
})

type MarketSearchPayload = {
  data?: unknown
  error?: string
}

const requireSessionUser = async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    throw new WatchlistOperationError('Unauthorized', 401)
  }
  return session.user.id
}

const requireWorkspacePermission = async (userId: string, workspaceId: string) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    throw new WatchlistOperationError('Access denied', 403)
  }
  if (permission === 'read') {
    throw new WatchlistOperationError('Write permission required', 403)
  }
}

const buildMarketHeaders = () => {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (env.MARKET_API_KEY) {
    headers.set('x-api-key', env.MARKET_API_KEY)
  }
  return headers
}

const toSearchRows = (payload: MarketSearchPayload): Array<Record<string, unknown>> => {
  if (!payload?.data) return []
  if (Array.isArray(payload.data)) {
    return payload.data.filter((row) => typeof row === 'object' && row !== null) as Array<
      Record<string, unknown>
    >
  }
  if (typeof payload.data === 'object') {
    return [payload.data as Record<string, unknown>]
  }
  return []
}

const toListingIdentity = (candidate: Record<string, unknown>): ListingIdentity | null =>
  toListingValueObject(candidate as ListingInputValue)

const requestListingCandidates = async (searchQuery: string) => {
  const params = new URLSearchParams()
  params.set('search_query', searchQuery)
  params.set('version', MARKET_API_VERSION)
  params.set(
    'filters',
    JSON.stringify({
      limit: 20,
    })
  )

  const response = await fetch(`${MARKET_API_URL}/api/search?${params.toString()}`, {
    method: 'GET',
    headers: buildMarketHeaders(),
  })
  const payload = (await response.json().catch(() => null)) as MarketSearchPayload | null
  if (!response.ok) {
    return []
  }
  return toSearchRows(payload ?? {})
}

const resolveTokenListing = async (token: string): Promise<ListingIdentity | null> => {
  const { exchange, symbol } = splitExchangeSymbol(token)
  const attempts = [token]
  if (symbol && symbol !== token) {
    attempts.push(symbol)
  }

  for (const query of attempts) {
    const candidates = await requestListingCandidates(query)
    if (candidates.length === 0) continue

    if (exchange) {
      const target = exchange.toUpperCase()
      for (const candidate of candidates) {
        const marketCode =
          typeof candidate.marketCode === 'string' ? candidate.marketCode.toUpperCase() : ''
        const mic =
          typeof candidate.primaryMicCode === 'string' ? candidate.primaryMicCode.toUpperCase() : ''
        if (marketCode === target || mic === target || marketCode.includes(target) || mic.includes(target)) {
          const normalized = toListingIdentity(candidate)
          if (normalized) return normalized
        }
      }
    }

    for (const candidate of candidates) {
      const normalized = toListingIdentity(candidate)
      if (normalized) return normalized
    }
  }

  return null
}

const handleRouteError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof WatchlistOperationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 })
  }
  logger.error(fallbackMessage, { error })
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ watchlistId: string }> }
) {
  try {
    const userId = await requireSessionUser()
    const { watchlistId } = await params
    const parsed = WatchlistImportSchema.parse(await request.json())
    await requireWorkspacePermission(userId, parsed.workspaceId)

    const tokens = parseWatchlistImportText(parsed.content)
    const resolvedListings: ListingIdentity[] = []
    const unresolvedSymbols: string[] = []

    for (const token of tokens) {
      const listing = await resolveTokenListing(token)
      if (!listing) {
        unresolvedSymbols.push(token)
        continue
      }
      resolvedListings.push(listing)
    }

    const result = await appendListingsToWatchlist(
      {
        workspaceId: parsed.workspaceId,
        userId,
      },
      watchlistId,
      resolvedListings
    )

    return NextResponse.json(
      {
        watchlist: result.watchlist,
        import: {
          addedCount: result.addedCount,
          skippedCount: result.skippedCount + unresolvedSymbols.length,
          unresolvedSymbols,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    return handleRouteError(error, 'Failed to import watchlist symbols')
  }
}
