import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import type { ListingInputValue } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { recordOrderHistory } from '@/lib/records/order-history.server'
import type { TradingOrderSubmitResponse } from '@/app/api/providers/trading/order/types'
import {
  createTradingProviderRequestId,
  logBrokerRequestFailure,
  resolveTradingProviderContext,
  resolveTradingProviderPreflight,
  resolveTradingProviderSelectedAccount,
} from '@/app/api/providers/trading/shared'
import { executeTradingProviderRequest, getTradingProvider } from '@/providers/trading'
import { resolveTradingListingIdentity } from '@/providers/trading/listing-resolution'
import { getStrictTradingOrderTypeDefinitions } from '@/providers/trading/order-types'
import {
  ALPACA_TRAILING_STOP_TRAIL_VALUE_ERROR,
  getAlpacaNotionalOrderTypeError,
} from '@/providers/trading/order-validation'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import { fetchBrokerJson, TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import { getTradingProviderConfig } from '@/providers/trading/providers'
import type { TradingOrder, TradingOrderType } from '@/providers/trading/types'
import {
  isTradingOrderListingSupported,
  resolveTradingListingAssetClass,
} from '@/providers/trading/utils'

const positiveNumberSchema = z.number().positive().finite()
const nonEmptyStringSchema = z.string().trim().min(1)

const orderListingSchema = z
  .object({
    listing_type: z.enum(['default', 'crypto', 'currency']),
    listing_id: z.string().optional(),
    base_id: z.string().optional(),
    quote_id: z.string().optional(),
  })
  .passthrough()

const portfolioIdentitySchema = z
  .object({
    providerId: nonEmptyStringSchema,
    credentialId: nonEmptyStringSchema,
    credentialServiceId: nonEmptyStringSchema,
    accountId: nonEmptyStringSchema,
  })
  .passthrough()

const orderSchema = z
  .object({
    workspaceId: nonEmptyStringSchema,
    portfolioIdentity: portfolioIdentitySchema,
    listing: orderListingSchema,
    side: z.enum(['buy', 'sell']),
    quantity: positiveNumberSchema.optional(),
    notional: positiveNumberSchema.optional(),
    orderSizingMode: z.enum(['quantity', 'notional']).optional(),
    orderType: nonEmptyStringSchema.optional(),
    timeInForce: nonEmptyStringSchema.optional(),
    limitPrice: positiveNumberSchema.optional(),
    stopPrice: positiveNumberSchema.optional(),
    trailPrice: positiveNumberSchema.optional(),
    trailPercent: positiveNumberSchema.optional(),
    orderClass: nonEmptyStringSchema.optional(),
    accessToken: nonEmptyStringSchema.optional(),
    submissionSource: z.enum(['manual', 'copilot', 'workflow']).optional(),
    logId: nonEmptyStringSchema.optional(),
  })
  .strict()

type OrderRequestData = z.infer<typeof orderSchema>

const errorResponse = (error: string, status = 400) => NextResponse.json({ error }, { status })

const hasNumber = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const getTimeInForceOptions = (providerId: string) =>
  getTradingProviderConfig(providerId)?.capabilities?.order?.timeInForce ?? []

const resolveTimeInForce = (
  providerId: string,
  requested: string | undefined
): string | NextResponse => {
  const timeInForceOptions = getTimeInForceOptions(providerId)
  const requestedTimeInForce = requested?.trim()

  if (requestedTimeInForce) {
    if (!timeInForceOptions.includes(requestedTimeInForce)) {
      return errorResponse('Unsupported timeInForce for provider')
    }
    return requestedTimeInForce
  }

  const provider = getTradingProvider(providerId)
  const defaultTimeInForce = provider.defaults?.timeInForce ?? timeInForceOptions[0]
  return defaultTimeInForce || errorResponse('timeInForce is required')
}

const resolveOrderType = (
  providerId: string,
  data: OrderRequestData,
  listing: ListingInputValue
): { orderType: TradingOrderType; requires: string[] } | NextResponse => {
  const context = {
    listing,
    orderClass: providerId === 'tradier' ? (data.orderClass ?? 'equity') : undefined,
  }
  const strictDefinitions = getStrictTradingOrderTypeDefinitions(providerId, context)
  if (!strictDefinitions.length) {
    return errorResponse('No supported order types for listing')
  }

  const requestedOrderType = data.orderType?.trim()
  if (requestedOrderType) {
    const requestedDefinition = strictDefinitions.find(
      (definition) => definition.id === requestedOrderType
    )
    if (!requestedDefinition) {
      return errorResponse('Unsupported order type')
    }
    return {
      orderType: requestedDefinition.id as TradingOrderType,
      requires: requestedDefinition.requires ?? [],
    }
  }

  const provider = getTradingProvider(providerId)
  const defaultDefinition =
    strictDefinitions.find((definition) => definition.id === provider.defaults?.orderType) ??
    strictDefinitions[0]

  return {
    orderType: defaultDefinition.id as TradingOrderType,
    requires: defaultDefinition.requires ?? [],
  }
}

const validateRequiredNumber = (
  data: OrderRequestData,
  field: 'limitPrice' | 'stopPrice' | 'trailPrice' | 'trailPercent'
): NextResponse | null => {
  return hasNumber(data[field]) ? null : errorResponse(`${field} is required`)
}

const validateAlpacaSizing = (
  data: OrderRequestData,
  orderType: TradingOrderType,
  timeInForce: string
): NextResponse | null => {
  const sizingMode = data.orderSizingMode ?? 'quantity'
  if (sizingMode === 'notional') {
    if (!hasNumber(data.notional)) return errorResponse('notional is required')
    const orderTypeError = getAlpacaNotionalOrderTypeError(orderType)
    if (orderTypeError) return errorResponse(orderTypeError)
    if (timeInForce !== 'day') {
      return errorResponse('Alpaca notional orders require timeInForce=day')
    }
    return null
  }

  return hasNumber(data.quantity) ? null : errorResponse('quantity is required')
}

const getOrderSizingMode = (providerId: string, data: OrderRequestData) =>
  providerId === 'alpaca' ? (data.orderSizingMode ?? 'quantity') : undefined

const validateTradierSizing = (data: OrderRequestData): NextResponse | null => {
  if (data.orderSizingMode === 'notional' || hasNumber(data.notional)) {
    return errorResponse('Notional sizing is only supported for Alpaca')
  }
  return hasNumber(data.quantity) ? null : errorResponse('quantity is required')
}

const validateOrderFields = (
  providerId: string,
  data: OrderRequestData,
  orderType: TradingOrderType,
  requires: string[],
  timeInForce: string
): NextResponse | null => {
  const sizingError =
    providerId === 'alpaca'
      ? validateAlpacaSizing(data, orderType, timeInForce)
      : validateTradierSizing(data)
  if (sizingError) return sizingError

  if (providerId === 'alpaca' && orderType === 'trailing_stop') {
    const hasTrailPrice = hasNumber(data.trailPrice)
    const hasTrailPercent = hasNumber(data.trailPercent)
    if (hasNumber(data.limitPrice) || hasNumber(data.stopPrice)) {
      return errorResponse('Alpaca trailing stop orders do not accept limitPrice or stopPrice')
    }
    if (hasTrailPrice === hasTrailPercent) {
      return errorResponse(ALPACA_TRAILING_STOP_TRAIL_VALUE_ERROR)
    }
    return null
  }

  for (const field of requires) {
    if (
      field === 'limitPrice' ||
      field === 'stopPrice' ||
      field === 'trailPrice' ||
      field === 'trailPercent'
    ) {
      const fieldError = validateRequiredNumber(data, field)
      if (fieldError) return fieldError
    }
  }

  return null
}

const toFetchBody = (body: string | Record<string, any> | undefined) => {
  if (typeof body === 'string' || body === undefined) return body
  return JSON.stringify(body)
}

const toRecord = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined

const readRecordText = (record: Record<string, unknown> | undefined, key: string) => {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const compactRecord = (record: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))

const hasResolvedListingDetails = (record: Record<string, unknown>): boolean => {
  const listingType = typeof record.listing_type === 'string' ? record.listing_type : null
  if (!listingType) return false
  const base = typeof record.base === 'string' ? record.base.trim() : ''
  if (!base) return false
  if (listingType === 'default') {
    return Boolean(resolveTradingListingAssetClass(record as ListingInputValue))
  }
  const quote = typeof record.quote === 'string' ? record.quote.trim() : ''
  return Boolean(quote)
}

const resolveOrderListing = async (
  listing: ListingInputValue
): Promise<ListingInputValue | NextResponse> => {
  const record = toRecord(listing)
  if (record && hasResolvedListingDetails(record)) return listing

  const identity = toListingValueObject(listing)
  if (!identity) return errorResponse('Resolved listing is required')

  const tradingIdentity = await resolveTradingListingIdentity({
    listing: identity,
    base: readRecordText(record, 'base'),
    quote: readRecordText(record, 'quote'),
    assetClass: resolveTradingListingAssetClass(listing),
  }).catch(() => null)
  if (!tradingIdentity) return errorResponse('Unable to resolve listing details for order')

  const resolved = await resolveListingIdentity(tradingIdentity).catch(() => null)
  return resolved ?? errorResponse('Unable to resolve listing details for order')
}

const buildOrderRequest = ({
  providerId,
  data,
  listing,
  accountId,
  accessToken,
  environment,
  orderType,
  timeInForce,
}: {
  providerId: string
  data: OrderRequestData
  listing: ListingInputValue
  accountId: string
  accessToken: string
  environment: 'paper' | 'live'
  orderType: TradingOrderType
  timeInForce: string
}) => {
  const usesLimitPrice = orderType === 'limit' || orderType === 'stop_limit'
  const usesStopPrice = orderType === 'stop' || orderType === 'stop_limit'
  const usesTrailValue = orderType === 'trailing_stop'
  const orderSizingMode = getOrderSizingMode(providerId, data)

  return executeTradingProviderRequest(providerId, {
    kind: 'order',
    accessToken,
    accountId,
    environment,
    listing,
    side: data.side,
    quantity: orderSizingMode === 'notional' ? undefined : data.quantity,
    notional: orderSizingMode === 'notional' ? data.notional : undefined,
    orderSizingMode,
    orderType,
    timeInForce,
    limitPrice: usesLimitPrice ? data.limitPrice : undefined,
    stopPrice: usesStopPrice ? data.stopPrice : undefined,
    trailPrice: usesTrailValue ? data.trailPrice : undefined,
    trailPercent: usesTrailValue ? data.trailPercent : undefined,
    orderClass: providerId === 'tradier' ? (data.orderClass ?? 'equity') : data.orderClass,
  })
}

const MESSAGE_KEYS = ['message', 'status_message', 'reason', 'reject_reason', 'error'] as const

const readMessage = (value: unknown, seen = new WeakSet<object>()): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!value || typeof value !== 'object') return null
  if (seen.has(value)) return null
  seen.add(value)

  const record = value as Record<string, unknown>

  for (const key of MESSAGE_KEYS) {
    const message = record[key]
    if (typeof message === 'string' && message.trim()) return message.trim()
  }

  const errors = record.errors
  if (Array.isArray(errors)) {
    for (const error of errors) {
      const nested = readMessage(error, seen)
      if (nested) return nested
    }
  } else {
    const nested = readMessage(errors, seen)
    if (nested) return nested
  }

  for (const key of ['order', 'raw'] as const) {
    const nested = readMessage(record[key], seen)
    if (nested) return nested
  }

  return null
}

const extractOrderProviderMessage = (
  rawOrder: unknown,
  normalizedOrder: TradingOrder | null
): string | null =>
  readMessage(rawOrder) ?? readMessage(normalizedOrder?.raw) ?? readMessage(normalizedOrder)

export async function POST(request: Request) {
  const requestId = createTradingProviderRequestId('order')
  const requestData = await resolveTradingProviderPreflight({
    request,
    schema: orderSchema,
  })
  if (requestData instanceof Response) return requestData

  const auth = await checkSessionOrInternalAuth(request as NextRequest, {
    requireWorkflowId: false,
  })
  if (!auth.success || !auth.userId) {
    return errorResponse(auth.error || 'Unauthorized', 401)
  }

  const portfolioIdentity = toPortfolioValueObject(requestData.portfolioIdentity)
  if (!portfolioIdentity) {
    return errorResponse('portfolioIdentity is required')
  }

  const baseContext = await resolveTradingProviderContext({
    requestData: {
      provider: portfolioIdentity.providerId,
      credentialId: portfolioIdentity.credentialId,
      credentialServiceId: portfolioIdentity.credentialServiceId,
    },
    requestId,
    userId: auth.userId,
    accessToken: auth.authType === AuthType.INTERNAL_JWT ? requestData.accessToken : undefined,
  })
  if (baseContext instanceof Response) return baseContext

  const workspaceAccess = await checkWorkspaceAccess(requestData.workspaceId, auth.userId)
  if (!workspaceAccess.exists || !workspaceAccess.canWrite) {
    return errorResponse('Not found', 404)
  }

  const resolvedListing = await resolveOrderListing(requestData.listing as ListingInputValue)
  if (resolvedListing instanceof Response) return resolvedListing

  const resolvedListingForRequest = resolvedListing as ListingInputValue
  const listingIdentity = toListingValueObject(resolvedListingForRequest)
  if (!listingIdentity) {
    return errorResponse('Resolved listing is required')
  }

  const assetClass = resolveTradingListingAssetClass(resolvedListingForRequest)
  if (!assetClass) {
    return errorResponse('Resolved listing asset class is required')
  }

  if (!isTradingOrderListingSupported(baseContext.providerId, resolvedListingForRequest)) {
    return errorResponse('Unsupported listing for provider')
  }

  const orderTypeResult = resolveOrderType(
    baseContext.providerId,
    requestData,
    resolvedListingForRequest
  )
  if (orderTypeResult instanceof Response) return orderTypeResult

  const timeInForce = resolveTimeInForce(baseContext.providerId, requestData.timeInForce)
  if (timeInForce instanceof Response) return timeInForce

  const fieldError = validateOrderFields(
    baseContext.providerId,
    requestData,
    orderTypeResult.orderType,
    orderTypeResult.requires,
    timeInForce
  )
  if (fieldError) return fieldError

  const accountContext = await resolveTradingProviderSelectedAccount({
    baseContext,
    accountId: portfolioIdentity.accountId,
  })
  if (accountContext instanceof Response) return accountContext

  const submissionSource =
    requestData.submissionSource ?? (auth.authType === AuthType.SESSION ? 'manual' : undefined)
  if (!submissionSource) {
    return errorResponse('submissionSource is required')
  }

  let rawOrder: unknown
  let normalizedOrder: TradingOrder
  try {
    const providerRequest = buildOrderRequest({
      providerId: baseContext.providerId,
      data: requestData,
      listing: resolvedListingForRequest,
      accountId: accountContext.accountId,
      accessToken: baseContext.accessToken,
      environment: baseContext.environment,
      orderType: orderTypeResult.orderType,
      timeInForce,
    })
    rawOrder = await fetchBrokerJson<unknown>({
      providerId: baseContext.providerId,
      url: providerRequest.url,
      init: {
        method: providerRequest.method,
        headers: providerRequest.headers,
        body: toFetchBody(providerRequest.body),
      },
    })
    const provider = getTradingProvider(baseContext.providerId)
    normalizedOrder = provider.normalizeOrder
      ? provider.normalizeOrder(rawOrder)
      : ({ raw: rawOrder } as TradingOrder)
  } catch (error) {
    logBrokerRequestFailure('order', error)
    if (error instanceof TradingBrokerRequestError) {
      return errorResponse('Broker request failed', 502)
    }
    return errorResponse(error instanceof Error ? error.message : 'Order submission failed')
  }

  const rawOrderRecord = toRecord(rawOrder)
  const normalizedOrderRecord = toRecord(normalizedOrder)
  const orderSizingMode = getOrderSizingMode(baseContext.providerId, requestData)
  const recordResult = await recordOrderHistory({
    workspaceId: requestData.workspaceId,
    provider: baseContext.providerId,
    environment: baseContext.environment,
    recordedAt: new Date().toISOString(),
    submissionSource,
    logId: requestData.logId,
    listingIdentity,
    request: compactRecord({
      credentialId: baseContext.credentialId,
      credentialServiceId: baseContext.credentialServiceId,
      accountId: accountContext.accountId,
      side: requestData.side,
      orderType: orderTypeResult.orderType,
      timeInForce,
      quantity: orderSizingMode === 'notional' ? undefined : requestData.quantity,
      notional: orderSizingMode === 'notional' ? requestData.notional : undefined,
      limitPrice: requestData.limitPrice,
      stopPrice: requestData.stopPrice,
      trailPrice: requestData.trailPrice,
      trailPercent: requestData.trailPercent,
      orderSizingMode,
      orderClass:
        baseContext.providerId === 'tradier'
          ? (requestData.orderClass ?? 'equity')
          : requestData.orderClass,
    }),
    response: {
      success: true,
      orderId: normalizedOrderRecord?.id ?? rawOrderRecord?.id ?? rawOrderRecord?.order_id ?? null,
      raw: rawOrderRecord ?? normalizedOrderRecord,
    },
    normalizedOrder: normalizedOrderRecord,
  })
  if (!recordResult.ok) {
    return errorResponse(recordResult.error, 500)
  }

  const response: TradingOrderSubmitResponse = {
    appOrderId: recordResult.record.id,
    order: normalizedOrder,
    provider: baseContext.providerId,
    accountId: accountContext.accountId,
    message: extractOrderProviderMessage(rawOrder, normalizedOrder),
  }

  return NextResponse.json(response)
}
