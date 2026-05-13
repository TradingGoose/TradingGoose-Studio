import { orderHistoryTable } from '@tradinggoose/db'
import { and, eq, gte, isNotNull, isNull, lte, or, type SQL, sql } from 'drizzle-orm'
import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingResolved,
  toListingValueObject,
} from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import {
  normalizeOrderDateFilterValue,
  normalizeOrdersFilterState,
  type OrdersFilterState,
} from '@/lib/records/order-filters'

type JsonRecord = Record<string, any>

export type RecordsOrderRow = typeof orderHistoryTable.$inferSelect & {
  linkedLog?: {
    id: string | null
    executionId: string | null
    workflowSummary: any
    level: string | null
    startedAt: Date | null
    endedAt: Date | null
  } | null
}

export type SerializedOrderRecord = {
  id: string
  workspaceId: string
  provider: string
  environment: string | null
  recordedAt: string
  submissionSource: string
  logId: string | null
  listingIdentity: unknown
  listing: {
    symbol: string | null
    name: string | null
    listingType: string | null
  }
  providerOrderId: string | null
  clientOrderId: string | null
  side: string | null
  status: string | null
  orderType: string | null
  timeInForce: string | null
  quantity: number | string | null
  filledQuantity: number | string | null
  remainingQuantity: number | string | null
  notional: number | string | null
  submittedPrice: number | string | null
  fillPrice: number | string | null
  averageFillPrice: number | string | null
  fee: number | string | null
  submittedAt: string | null
  updatedAt: string | null
  filledAt: string | null
  canceledAt: string | null
  expiredAt: string | null
  message: string | null
  hasLinkedLog: boolean
  linkedLog: {
    id: string
    executionId: string | null
    workflowName: string | null
    level: string | null
    startedAt: string | null
    endedAt: string | null
  } | null
  request?: unknown
  response?: unknown
  normalizedOrder?: unknown
}

export type SerializedOrderSearchOption = {
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

const SECRET_KEY_EXACT_KEYS = new Set([
  'accountid',
  'accountnumber',
  'accesstoken',
  'apikey',
  'apisecret',
  'authorization',
  'credentialid',
  'password',
  'refreshtoken',
  'serviceid',
])
const SECRET_KEY_PATTERN = /credential|secret|token|password|authorization/i

const shouldRedactKey = (key: string) => {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase()
  return SECRET_KEY_EXACT_KEYS.has(normalized) || SECRET_KEY_PATTERN.test(key)
}

export function deepRedactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deepRedactSecrets(entry))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, entry]) => [
      key,
      shouldRedactKey(key) ? '[redacted]' : deepRedactSecrets(entry),
    ])
  )
}

const toRecord = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}

const readString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

const ORDER_MESSAGE_KEYS = [
  'message',
  'statusMessage',
  'status_message',
  'reason',
  'rejectReason',
  'reject_reason',
] as const

const readOrderMessageValues = (...records: JsonRecord[]) =>
  records.flatMap((record) => ORDER_MESSAGE_KEYS.map((key) => record[key]))

const readNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

const readValue = (...values: unknown[]) => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value as any
  }
  return null
}

const toIso = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
    const text = readString(value)
    if (!text) continue
    const date = new Date(text)
    if (Number.isFinite(date.getTime())) return date.toISOString()
  }
  return null
}

const normalizeText = (value: unknown) =>
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    : null

const readListing = (listingIdentity: unknown, normalized: JsonRecord, response: JsonRecord) => {
  const listing = toRecord(listingIdentity)
  const raw = toRecord(response.raw)
  const rawOrder = toRecord(raw.order)
  const symbol = readString(
    normalized.symbol,
    response.symbol,
    raw.symbol,
    rawOrder.symbol,
    listing.listing_id,
    listing.base_id
  )
  return {
    symbol,
    name: readString(listing.name, listing.provider_symbol, listing.base, listing.base_id),
    listingType: readString(listing.listing_type),
  }
}

const splitSymbolAndQuote = (
  symbol: string | null,
  existingQuote: string | null
): { symbol: string | null; quote: string | null } => {
  if (!symbol || existingQuote || !symbol.includes('/')) {
    return { symbol, quote: existingQuote }
  }

  const [base, quote] = symbol.split('/')
  return {
    symbol: base?.trim() || symbol,
    quote: quote?.trim() || null,
  }
}

const resolveOrderSearchListing = async (
  identity: ListingIdentity | null,
  cache: Map<string, ListingResolved | null>
) => {
  if (!identity) return null
  const key = getListingIdentityKey(identity)
  if (cache.has(key)) return cache.get(key) ?? null

  const resolved = await resolveListingIdentity(identity).catch(() => null)
  cache.set(key, resolved ?? null)
  return resolved ?? null
}

const readOrderRequestString = (row: Pick<RecordsOrderRow, 'request'>, key: string) => {
  const request = toRecord(row.request)
  return readString(request[key])
}

export const readOrderAccountId = (row: Pick<RecordsOrderRow, 'request'>) =>
  readOrderRequestString(row, 'accountId')

export const readOrderCredentialId = (row: Pick<RecordsOrderRow, 'request'>) =>
  readOrderRequestString(row, 'credentialId')

export const readOrderServiceId = (row: Pick<RecordsOrderRow, 'request'>) =>
  readOrderRequestString(row, 'serviceId')

export function serializeOrderRecord(
  row: RecordsOrderRow,
  details: 'basic' | 'full' = 'basic'
): SerializedOrderRecord {
  const request = toRecord(row.request)
  const response = toRecord(row.response)
  const raw = toRecord(response.raw)
  const rawOrder = toRecord(raw.order)
  const normalized = toRecord(row.normalizedOrder)
  const listing = readListing(row.listingIdentity, normalized, response)
  const linkedSummary = row.linkedLog?.workflowSummary as { name?: string } | null | undefined

  const providerOrderId = readString(
    normalized.id,
    normalized.orderId,
    response.orderId,
    raw.id,
    raw.order_id,
    rawOrder.id,
    rawOrder.order_id
  )
  const status = normalizeText(
    readString(normalized.status, response.status, raw.status, raw.state, rawOrder.status)
  )

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    environment: row.environment,
    recordedAt: row.recordedAt.toISOString(),
    submissionSource: row.submissionSource,
    logId: row.logId,
    listingIdentity: row.listingIdentity,
    listing,
    providerOrderId,
    clientOrderId: readString(
      response.clientOrderId,
      raw.client_order_id,
      rawOrder.client_order_id
    ),
    side: normalizeText(readString(normalized.side, request.side, raw.side, rawOrder.side)),
    status,
    orderType: normalizeText(
      readString(request.orderType, raw.type, raw.order_type, rawOrder.type, rawOrder.order_type)
    ),
    timeInForce: normalizeText(
      readString(request.timeInForce, raw.time_in_force, rawOrder.time_in_force)
    ),
    quantity: readValue(request.quantity, raw.qty, raw.quantity, rawOrder.quantity),
    filledQuantity: readValue(
      normalized.filledQty,
      normalized.filledQuantity,
      raw.filled_qty,
      raw.filledQuantity,
      raw.exec_quantity,
      rawOrder.exec_quantity,
      rawOrder.filled_quantity
    ),
    remainingQuantity: readValue(
      normalized.remainingQuantity,
      raw.remaining_qty,
      rawOrder.remaining_quantity
    ),
    notional: readValue(request.notional, raw.notional, rawOrder.notional),
    submittedPrice: readValue(
      request.limitPrice,
      request.stopPrice,
      raw.limit_price,
      raw.stop_price
    ),
    fillPrice: readValue(raw.fill_price, rawOrder.fill_price),
    averageFillPrice: readValue(
      normalized.averageFillPrice,
      raw.filled_avg_price,
      raw.avg_fill_price,
      raw.average_fill_price,
      rawOrder.avg_fill_price,
      rawOrder.average_fill_price
    ),
    fee: readValue(raw.fee, raw.commission, rawOrder.fee, rawOrder.commission),
    submittedAt: toIso(
      normalized.submittedAt,
      response.submittedAt,
      raw.submitted_at,
      rawOrder.submitted_at
    ),
    updatedAt: toIso(normalized.updatedAt, response.updatedAt, raw.updated_at, rawOrder.updated_at),
    filledAt: toIso(normalized.filledAt, raw.filled_at, rawOrder.filled_at),
    canceledAt: toIso(normalized.canceledAt, raw.canceled_at, rawOrder.canceled_at),
    expiredAt: toIso(normalized.expiredAt, raw.expired_at, rawOrder.expired_at),
    message: readString(
      response.errorMessage,
      ...readOrderMessageValues(response, normalized, raw),
      raw.error,
      ...readOrderMessageValues(rawOrder)
    ),
    hasLinkedLog: Boolean(row.logId),
    linkedLog:
      row.linkedLog?.id && row.linkedLog.id === row.logId
        ? {
            id: row.linkedLog.id,
            executionId: row.linkedLog.executionId,
            workflowName: linkedSummary?.name ?? null,
            level: row.linkedLog.level,
            startedAt: row.linkedLog.startedAt?.toISOString() ?? null,
            endedAt: row.linkedLog.endedAt?.toISOString() ?? null,
          }
        : null,
    ...(details === 'full'
      ? {
          request: deepRedactSecrets(row.request),
          response: deepRedactSecrets(row.response),
          normalizedOrder: deepRedactSecrets(row.normalizedOrder),
        }
      : {}),
  }
}

export async function serializeOrderSearchOptions(
  rows: RecordsOrderRow[]
): Promise<SerializedOrderSearchOption[]> {
  const listingCache = new Map<string, ListingResolved | null>()

  return Promise.all(
    rows.map(async (row) => {
      const record = serializeOrderRecord(row)
      const listingIdentity = toListingValueObject((row.listingIdentity ?? undefined) as any)
      const resolvedListing = await resolveOrderSearchListing(listingIdentity, listingCache)
      const symbolAndQuote = splitSymbolAndQuote(
        readString(resolvedListing?.base, record.listing.symbol),
        readString(resolvedListing?.quote)
      )

      return {
        id: record.id,
        provider: record.provider,
        environment: record.environment,
        side: record.side,
        quantity: readNumber(record.quantity),
        notional: readNumber(record.notional),
        placedAt: record.submittedAt ?? record.recordedAt,
        recordedAt: record.recordedAt,
        symbol: symbolAndQuote.symbol,
        quote: symbolAndQuote.quote,
        companyName: readString(resolvedListing?.name, record.listing.name),
        iconUrl: readString(resolvedListing?.iconUrl),
        assetClass: readString(resolvedListing?.assetClass),
        listingType: readString(
          listingIdentity?.listing_type,
          resolvedListing?.listing_type,
          record.listing.listingType
        ),
      }
    })
  )
}

export function buildBaseOrderConditions(params: {
  startDate?: string
  endDate?: string
  linkedLog?: string
}): SQL | undefined {
  const conditions: SQL[] = []
  const startDate = normalizeOrderDateFilterValue(params.startDate)
  const endDate = normalizeOrderDateFilterValue(params.endDate)

  if (startDate) conditions.push(gte(orderHistoryTable.recordedAt, new Date(startDate)))
  if (endDate) conditions.push(lte(orderHistoryTable.recordedAt, new Date(endDate)))
  if (params.linkedLog === 'true') conditions.push(isNotNull(orderHistoryTable.logId))
  if (params.linkedLog === 'false') conditions.push(isNull(orderHistoryTable.logId))

  return conditions.length ? and(...conditions) : undefined
}

const coalesceText = (...values: SQL[]) => sql<string>`COALESCE(${sql.join(values, sql`, `)}, '')`

const normalizedText = (...values: SQL[]) =>
  sql<string>`regexp_replace(lower(${coalesceText(...values)}), '[\\s-]+', '_', 'g')`

const numericText = (...values: SQL[]) => {
  const value = coalesceText(...values)
  return sql<number>`CASE WHEN ${value} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${value}::numeric ELSE NULL END`
}

const timestampText = (value: SQL) =>
  sql<Date>`CASE WHEN ${value} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN ${value}::timestamp ELSE NULL END`

const orderStatusExpr = () =>
  normalizedText(
    sql`${orderHistoryTable.normalizedOrder}->>'status'`,
    sql`${orderHistoryTable.response}->>'status'`,
    sql`${orderHistoryTable.response}->'raw'->>'status'`,
    sql`${orderHistoryTable.response}->'raw'->>'state'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'status'`
  )

const orderSideExpr = () =>
  normalizedText(
    sql`${orderHistoryTable.normalizedOrder}->>'side'`,
    sql`${orderHistoryTable.request}->>'side'`,
    sql`${orderHistoryTable.response}->'raw'->>'side'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'side'`
  )

const orderTypeExpr = () =>
  normalizedText(
    sql`${orderHistoryTable.request}->>'orderType'`,
    sql`${orderHistoryTable.response}->'raw'->>'type'`,
    sql`${orderHistoryTable.response}->'raw'->>'order_type'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'type'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'order_type'`
  )

const timeInForceExpr = () =>
  normalizedText(
    sql`${orderHistoryTable.request}->>'timeInForce'`,
    sql`${orderHistoryTable.response}->'raw'->>'time_in_force'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'time_in_force'`
  )

const listingExpr = () =>
  coalesceText(
    sql`${orderHistoryTable.normalizedOrder}->>'symbol'`,
    sql`${orderHistoryTable.response}->>'symbol'`,
    sql`${orderHistoryTable.response}->'raw'->>'symbol'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'symbol'`,
    sql`${orderHistoryTable.listingIdentity}->>'listing_id'`,
    sql`${orderHistoryTable.listingIdentity}->>'base_id'`
  )

const listingSearchExpr = () =>
  sql<string>`COALESCE(${orderHistoryTable.listingIdentity}->>'listing_id', '') || ' ' ||
    COALESCE(${orderHistoryTable.listingIdentity}->>'base_id', '') || ' ' ||
    COALESCE(${orderHistoryTable.listingIdentity}->>'quote_id', '') || ' ' ||
    COALESCE(${orderHistoryTable.listingIdentity}->>'listing_type', '')`

const providerOrderIdExpr = () =>
  coalesceText(
    sql`${orderHistoryTable.normalizedOrder}->>'id'`,
    sql`${orderHistoryTable.normalizedOrder}->>'orderId'`,
    sql`${orderHistoryTable.response}->>'orderId'`,
    sql`${orderHistoryTable.response}->'raw'->>'id'`,
    sql`${orderHistoryTable.response}->'raw'->>'order_id'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'id'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'order_id'`
  )

const clientOrderIdExpr = () =>
  coalesceText(
    sql`${orderHistoryTable.response}->>'clientOrderId'`,
    sql`${orderHistoryTable.response}->'raw'->>'client_order_id'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'client_order_id'`
  )

const orderMessageExpr = () =>
  coalesceText(
    sql`${orderHistoryTable.response}->>'errorMessage'`,
    ...ORDER_MESSAGE_KEYS.map((key) => sql`${orderHistoryTable.response}->> ${key}`),
    ...ORDER_MESSAGE_KEYS.map((key) => sql`${orderHistoryTable.normalizedOrder}->> ${key}`),
    ...ORDER_MESSAGE_KEYS.map((key) => sql`${orderHistoryTable.response}->'raw'->> ${key}`),
    sql`${orderHistoryTable.response}->'raw'->>'error'`,
    ...ORDER_MESSAGE_KEYS.map((key) => sql`${orderHistoryTable.response}->'raw'->'order'->> ${key}`)
  )

const submittedAtExpr = () =>
  sql<Date>`COALESCE(
    ${timestampText(sql`NULLIF(${orderHistoryTable.normalizedOrder}->>'submittedAt', '')`)},
    ${timestampText(sql`NULLIF(${orderHistoryTable.response}->>'submittedAt', '')`)},
    ${timestampText(sql`NULLIF(${orderHistoryTable.response}->'raw'->>'submitted_at', '')`)},
    ${timestampText(sql`NULLIF(${orderHistoryTable.response}->'raw'->'order'->>'submitted_at', '')`)}
  )`

const quantityExpr = () =>
  numericText(
    sql`${orderHistoryTable.request}->>'quantity'`,
    sql`${orderHistoryTable.response}->'raw'->>'qty'`,
    sql`${orderHistoryTable.response}->'raw'->>'quantity'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'quantity'`
  )

const filledQuantityExpr = () =>
  numericText(
    sql`${orderHistoryTable.normalizedOrder}->>'filledQty'`,
    sql`${orderHistoryTable.normalizedOrder}->>'filledQuantity'`,
    sql`${orderHistoryTable.response}->'raw'->>'filled_qty'`,
    sql`${orderHistoryTable.response}->'raw'->>'filledQuantity'`,
    sql`${orderHistoryTable.response}->'raw'->>'exec_quantity'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'exec_quantity'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'filled_quantity'`
  )

const averageFillPriceExpr = () =>
  numericText(
    sql`${orderHistoryTable.normalizedOrder}->>'averageFillPrice'`,
    sql`${orderHistoryTable.response}->'raw'->>'filled_avg_price'`,
    sql`${orderHistoryTable.response}->'raw'->>'avg_fill_price'`,
    sql`${orderHistoryTable.response}->'raw'->>'average_fill_price'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'avg_fill_price'`,
    sql`${orderHistoryTable.response}->'raw'->'order'->>'average_fill_price'`
  )

export function buildOrderWhereCondition(
  workspaceId: string,
  filters: Partial<OrdersFilterState>,
  options: { joinedSearchExpressions?: SQL[] } = {}
) {
  const normalized = normalizeOrdersFilterState(filters)
  const conditions: SQL[] = [eq(orderHistoryTable.workspaceId, workspaceId)]
  const baseConditions = buildBaseOrderConditions({
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    linkedLog: normalized.linkedLog,
  })

  if (baseConditions) conditions.push(baseConditions)
  if (normalized.provider) conditions.push(eq(orderHistoryTable.provider, normalized.provider))
  if (normalized.environment)
    conditions.push(eq(orderHistoryTable.environment, normalized.environment))
  if (normalized.submissionSource) {
    conditions.push(eq(orderHistoryTable.submissionSource, normalized.submissionSource))
  }
  if (normalized.status) conditions.push(eq(orderStatusExpr(), normalized.status))
  if (normalized.side) conditions.push(eq(orderSideExpr(), normalized.side))
  if (normalized.orderType) conditions.push(eq(orderTypeExpr(), normalized.orderType))
  if (normalized.timeInForce) conditions.push(eq(timeInForceExpr(), normalized.timeInForce))

  if (normalized.orderSearch) {
    const search = `%${normalized.orderSearch}%`
    conditions.push(
      or(
        sql`${orderHistoryTable.id}::text ILIKE ${search}`,
        sql`COALESCE(${orderHistoryTable.provider}, '') ILIKE ${search}`,
        sql`COALESCE(${orderHistoryTable.environment}, '') ILIKE ${search}`,
        sql`COALESCE(${orderHistoryTable.submissionSource}, '') ILIKE ${search}`,
        sql`${listingExpr()} ILIKE ${search}`,
        sql`${listingSearchExpr()} ILIKE ${search}`,
        sql`${providerOrderIdExpr()} ILIKE ${search}`,
        sql`${clientOrderIdExpr()} ILIKE ${search}`,
        sql`${orderStatusExpr()} ILIKE ${search}`,
        sql`${orderSideExpr()} ILIKE ${search}`,
        sql`${orderTypeExpr()} ILIKE ${search}`,
        sql`${timeInForceExpr()} ILIKE ${search}`,
        sql`${orderMessageExpr()} ILIKE ${search}`,
        sql`to_char(${orderHistoryTable.recordedAt}, 'YYYY-MM-DD') ILIKE ${search}`,
        sql`to_char(${orderHistoryTable.recordedAt}, 'Mon DD') ILIKE ${search}`,
        sql`to_char(${orderHistoryTable.recordedAt}, 'Mon D') ILIKE ${search}`,
        ...(options.joinedSearchExpressions ?? []).map(
          (expression) => sql`${expression} ILIKE ${search}`
        )
      ) as SQL
    )
  }

  return and(...conditions) as SQL
}

const sortExpression = (sortBy: OrdersFilterState['orderSortBy']): SQL => {
  if (sortBy === 'submittedAt') return submittedAtExpr()
  if (sortBy === 'listing') return listingExpr()
  if (sortBy === 'provider') return sql`${orderHistoryTable.provider}`
  if (sortBy === 'environment') return sql`${orderHistoryTable.environment}`
  if (sortBy === 'status') return orderStatusExpr()
  if (sortBy === 'side') return orderSideExpr()
  if (sortBy === 'orderType') return orderTypeExpr()
  if (sortBy === 'quantity') return quantityExpr()
  if (sortBy === 'filledQuantity') return filledQuantityExpr()
  if (sortBy === 'averageFillPrice') return averageFillPriceExpr()
  return sql`${orderHistoryTable.recordedAt}`
}

export function buildOrderOrderBy(filters: OrdersFilterState) {
  const { orderSortBy, orderSortOrder } = normalizeOrdersFilterState(filters)
  const direction = sql.raw(orderSortOrder)
  const idDirection = sql.raw(orderSortBy === 'recordedAt' ? orderSortOrder : 'desc')

  return [
    sql`${sortExpression(orderSortBy)} ${direction} NULLS LAST`,
    sql`${orderHistoryTable.recordedAt} DESC NULLS LAST`,
    sql`${orderHistoryTable.id} ${idDirection}`,
  ]
}
