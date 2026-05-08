import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, desc, eq, gte, lt, or, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  areListingIdentitiesEqual,
  type ListingIdentity,
  type ListingResolved,
  toListingValueObject,
} from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
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
  return toListingValueObject((row.listingIdentity ?? undefined) as any)
}

const resolveListingForRow = async (
  identity: ListingIdentity | null,
  cache: Array<{ identity: ListingIdentity; resolved: ListingResolved | null }>
): Promise<ListingResolved | null> => {
  if (!identity) return null

  const cached = cache.find((entry) => areListingIdentitiesEqual(entry.identity, identity))
  if (cached) {
    return cached.resolved
  }

  const resolved = await resolveListingIdentity(identity).catch(() => null)
  cache.push({ identity, resolved: resolved ?? null })
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
  listingCache: Array<{ identity: ListingIdentity; resolved: ListingResolved | null }>
): Promise<OrderHistorySearchResult> => {
  const requestRecord = toRecord(row.request)
  const responseRecord = toRecord(row.response)
  const normalizedRecord = toRecord(row.normalizedOrder)
  const listingIdentity = parseListingIdentityFromRow(row)

  const resolvedListing = await resolveListingForRow(listingIdentity, listingCache)

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
    listingType: readString(listingIdentity?.listing_type, resolvedListing?.listing_type),
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

const textSearchConditions = (query: string, values: SQL[]): SQL[] => {
  if (isUuid(query)) {
    return values.map((value) => sql`NULLIF(${value}, '') = ${query}`)
  }

  const searchTerm = `%${query}%`
  return values.map((value) => sql`COALESCE(${value}, '') ILIKE ${searchTerm}`)
}

const buildSearchConditions = (query: string): SQL[] => {
  const uuidQuery = isUuid(query)
  const searchTerm = `%${query}%`
  const conditions: SQL[] = [
    uuidQuery
      ? eq(orderHistoryTable.id, query)
      : sql`${orderHistoryTable.id}::text ILIKE ${searchTerm}`,
    ...textSearchConditions(query, [
      sql`${orderHistoryTable.listingIdentity}->>'listing_id'`,
      sql`${orderHistoryTable.listingIdentity}->>'base_id'`,
      sql`${orderHistoryTable.listingIdentity}->>'quote_id'`,
      sql`${orderHistoryTable.listingIdentity}->>'listing_type'`,
      sql`(${orderHistoryTable.listingIdentity}->>'base_id') || ':' || (${orderHistoryTable.listingIdentity}->>'quote_id')`,
      sql`${orderHistoryTable.normalizedOrder}->>'id'`,
      sql`${orderHistoryTable.normalizedOrder}->>'orderId'`,
      sql`${orderHistoryTable.normalizedOrder}->'raw'->>'id'`,
      sql`${orderHistoryTable.normalizedOrder}->>'symbol'`,
      sql`${orderHistoryTable.normalizedOrder}->>'quote'`,
      sql`${orderHistoryTable.normalizedOrder}->>'side'`,
      sql`${orderHistoryTable.response}->>'orderId'`,
      sql`${orderHistoryTable.response}->>'clientOrderId'`,
      sql`${orderHistoryTable.response}->>'symbol'`,
      sql`${orderHistoryTable.response}->>'quote'`,
      sql`${orderHistoryTable.response}->'raw'->>'id'`,
      sql`${orderHistoryTable.response}->'raw'->>'order_id'`,
      sql`${orderHistoryTable.response}->'raw'->'order'->>'id'`,
      sql`${orderHistoryTable.response}->'raw'->'order'->>'order_id'`,
      sql`${orderHistoryTable.response}->'raw'->'order'->>'client_order_id'`,
      sql`${orderHistoryTable.response}->'raw'->'order'->>'symbol'`,
      sql`${orderHistoryTable.request}->>'symbol'`,
      sql`${orderHistoryTable.request}->>'side'`,
    ]),
  ]

  if (!uuidQuery) {
    conditions.push(
      sql`to_char(${orderHistoryTable.recordedAt}, 'YYYY-MM-DD') ILIKE ${searchTerm}`,
      sql`to_char(${orderHistoryTable.recordedAt}, 'Mon DD') ILIKE ${searchTerm}`,
      sql`to_char(${orderHistoryTable.recordedAt}, 'Mon D') ILIKE ${searchTerm}`
    )

    const dateSearchCondition = buildDateSearchCondition(query)
    if (dateSearchCondition) {
      conditions.push(dateSearchCondition)
    }
  }

  return conditions
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const requestedWorkspaceId = readString(url.searchParams.get('workspaceId'))
    const query = readString(url.searchParams.get('q')) ?? ''
    const limit = parseLimit(url.searchParams.get('limit'))

    const workspaceId = requestedWorkspaceId ?? ''
    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId is required' } },
        { status: 400 }
      )
    }

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ success: false, error: { message: 'Not found' } }, { status: 404 })
    }

    const conditions: SQL[] = [eq(orderHistoryTable.workspaceId, workspaceId)]

    if (query) {
      conditions.push(or(...buildSearchConditions(query)) as SQL)
    }

    const rows = await db
      .select()
      .from(orderHistoryTable)
      .where(and(...conditions))
      .orderBy(desc(orderHistoryTable.recordedAt))
      .limit(limit)

    const listingCache: Array<{ identity: ListingIdentity; resolved: ListingResolved | null }> = []
    const results = await Promise.all(rows.map((row) => mapOrderRow(row, listingCache)))

    return NextResponse.json(
      {
        success: true,
        data: {
          results,
          count: results.length,
          workspaceId,
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
