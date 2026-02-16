import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, desc, eq, gte, lt, or, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type ListingIdentity,
  type ListingResolved,
  resolveListingKey,
  toListingValueObject,
} from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('TradingOrderHistorySearchAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MAX_LIMIT = 20
const DEFAULT_LIMIT = 20

type OrderHistoryRow = typeof orderHistoryTable.$inferSelect
type JsonRecord = Record<string, unknown>

interface OrderHistorySearchResult {
  id: string
  provider: string
  environment: string | null
  side: string | null
  quantity: number | null
  notional: number | null
  placedAt: string | null
  recordedAt: string
  symbol: string | null
  quote: string | null
  companyName: string | null
  iconUrl: string | null
  assetClass: string | null
  listingType: string | null
}

const isUuid = (value: string): boolean => UUID_PATTERN.test(value.trim())

const toRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

const readString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

const readNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }
  return null
}

const toIsoDate = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString()
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue
      const parsed = new Date(trimmed)
      if (Number.isFinite(parsed.getTime())) {
        return parsed.toISOString()
      }
    }
  }
  return null
}

const parseListingIdentityFromRow = (row: OrderHistoryRow): ListingIdentity | null => {
  const fromIdentity = toListingValueObject((row.listingIdentity ?? undefined) as any)
  if (fromIdentity) {
    return fromIdentity
  }

  const listingType = row.listingType
  if (listingType !== 'default' && listingType !== 'crypto' && listingType !== 'currency') {
    return null
  }

  if (listingType === 'default') {
    const listingId = readString(row.listingId, row.listingKey)
    if (!listingId) return null
    return {
      listing_id: listingId,
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    }
  }

  const listingKey = readString(row.listingKey)
  if (!listingKey || !listingKey.includes(':')) {
    return null
  }

  const [baseId, quoteId] = listingKey.split(':')
  const base = baseId?.trim() ?? ''
  const quote = quoteId?.trim() ?? ''
  if (!base || !quote) return null

  return {
    listing_id: '',
    base_id: base,
    quote_id: quote,
    listing_type: listingType,
  }
}

const resolveListingForRow = async (
  row: OrderHistoryRow,
  cache: Map<string, ListingResolved | null>
): Promise<ListingResolved | null> => {
  const identity = parseListingIdentityFromRow(row)
  if (!identity) return null

  const key = resolveListingKey(identity)
  if (!key) return null

  const cached = cache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const resolved = await resolveListingIdentity(identity).catch(() => null)
  cache.set(key, resolved ?? null)
  return resolved ?? null
}

const normalizeSide = (side: string | null): string | null => {
  if (!side) return null
  const normalized = side.trim().toLowerCase()
  if (normalized === 'buy' || normalized === 'sell') return normalized
  return normalized || null
}

const splitSymbolAndQuote = (
  symbol: string | null,
  existingQuote: string | null
): { symbol: string | null; quote: string | null } => {
  if (!symbol) return { symbol: null, quote: existingQuote }
  if (existingQuote) return { symbol, quote: existingQuote }

  if (symbol.includes('/')) {
    const [base, quote] = symbol.split('/')
    const baseTrimmed = base?.trim() ?? ''
    const quoteTrimmed = quote?.trim() ?? ''
    return {
      symbol: baseTrimmed || symbol,
      quote: quoteTrimmed || null,
    }
  }

  return { symbol, quote: existingQuote }
}

const mapOrderRow = async (
  row: OrderHistoryRow,
  listingCache: Map<string, ListingResolved | null>
): Promise<OrderHistorySearchResult> => {
  const requestRecord = toRecord(row.request)
  const responseRecord = toRecord(row.response)
  const normalizedRecord = toRecord(row.normalizedOrder)

  const resolvedListing = await resolveListingForRow(row, listingCache)

  const rawSymbol = readString(
    resolvedListing?.base,
    normalizedRecord?.symbol,
    responseRecord?.symbol,
    requestRecord?.symbol
  )
  const rawQuote = readString(
    resolvedListing?.quote,
    normalizedRecord?.quote,
    responseRecord?.quote,
    requestRecord?.quote
  )
  const splitSymbol = splitSymbolAndQuote(rawSymbol, rawQuote)

  return {
    id: row.id,
    provider: row.provider,
    environment: readString(row.environment),
    side: normalizeSide(
      readString(requestRecord?.side, normalizedRecord?.side, responseRecord?.side)
    ),
    quantity: readNumber(requestRecord?.quantity, requestRecord?.qty),
    notional: readNumber(requestRecord?.notional),
    placedAt: toIsoDate(
      responseRecord?.submittedAt,
      responseRecord?.createdAt,
      normalizedRecord?.submittedAt,
      normalizedRecord?.createdAt,
      normalizedRecord?.filledAt,
      row.recordedAt
    ),
    recordedAt: row.recordedAt.toISOString(),
    symbol: splitSymbol.symbol,
    quote: splitSymbol.quote,
    companyName: readString(resolvedListing?.name),
    iconUrl: readString(resolvedListing?.iconUrl),
    assetClass: readString(resolvedListing?.assetClass),
    listingType: readString(row.listingType, resolvedListing?.listing_type),
  }
}

const parseLimit = (value: string | null): number => {
  if (!value) return DEFAULT_LIMIT
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

const buildDateSearchCondition = (query: string): SQL | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query)) return null

  const start = new Date(`${query}T00:00:00.000Z`)
  if (!Number.isFinite(start.getTime())) return null

  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  return and(gte(orderHistoryTable.recordedAt, start), lt(orderHistoryTable.recordedAt, end)) as SQL
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const url = new URL(request.url)
    const workflowId = readString(url.searchParams.get('workflowId'))
    const query = readString(url.searchParams.get('q')) ?? ''
    const limit = parseLimit(url.searchParams.get('limit'))

    const conditions: SQL[] = []

    if (workflowId) {
      conditions.push(eq(orderHistoryTable.workflowId, workflowId))
    }

    if (query) {
      if (isUuid(query)) {
        conditions.push(eq(orderHistoryTable.id, query))
      } else {
        const searchTerm = `%${query}%`
        const dateSearchCondition = buildDateSearchCondition(query)
        const searchConditions: SQL[] = [
          sql`${orderHistoryTable.id}::text ILIKE ${searchTerm}`,
          sql`COALESCE(${orderHistoryTable.listingId}, '') ILIKE ${searchTerm}`,
          sql`COALESCE(${orderHistoryTable.listingKey}, '') ILIKE ${searchTerm}`,
          sql`${orderHistoryTable.normalizedOrder}::text ILIKE ${searchTerm}`,
          sql`${orderHistoryTable.response}::text ILIKE ${searchTerm}`,
          sql`${orderHistoryTable.request}::text ILIKE ${searchTerm}`,
          sql`to_char(${orderHistoryTable.recordedAt}, 'YYYY-MM-DD') ILIKE ${searchTerm}`,
          sql`to_char(${orderHistoryTable.recordedAt}, 'Mon DD') ILIKE ${searchTerm}`,
          sql`to_char(${orderHistoryTable.recordedAt}, 'Mon D') ILIKE ${searchTerm}`,
        ]

        if (dateSearchCondition) {
          searchConditions.push(dateSearchCondition)
        }

        conditions.push(or(...searchConditions) as SQL)
      }
    }

    const whereClause = conditions.length ? and(...conditions) : undefined

    const rows = whereClause
      ? await db
          .select()
          .from(orderHistoryTable)
          .where(whereClause)
          .orderBy(desc(orderHistoryTable.recordedAt))
          .limit(limit)
      : await db
          .select()
          .from(orderHistoryTable)
          .orderBy(desc(orderHistoryTable.recordedAt))
          .limit(limit)

    const listingCache = new Map<string, ListingResolved | null>()
    const results = await Promise.all(rows.map((row) => mapOrderRow(row, listingCache)))

    return NextResponse.json(
      {
        success: true,
        data: {
          results,
          count: results.length,
          workflowId: workflowId ?? null,
          query,
          limit,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to search order history records`, { error })

    return NextResponse.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to search order history',
        },
      },
      { status: 500 }
    )
  }
}
