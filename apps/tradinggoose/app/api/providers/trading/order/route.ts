import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ListingInputValue } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
import type { QuickOrderSubmitResponse } from '@/app/api/providers/trading/order/types'
import {
  createTradingProviderRequestId,
  logBrokerRequestFailure,
  resolveTradingProviderContext,
  resolveTradingProviderPreflight,
  resolveTradingProviderSelectedAccount,
} from '@/app/api/providers/trading/shared'
import { executeTradingProviderRequest, getTradingProvider } from '@/providers/trading'
import { getStrictTradingOrderTypeDefinitions } from '@/providers/trading/order-types'
import {
  ALPACA_TRAILING_STOP_TRAIL_VALUE_ERROR,
  getAlpacaNotionalOrderTypeError,
} from '@/providers/trading/order-validation'
import { fetchBrokerJson, TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import { getTradingProviderConfig } from '@/providers/trading/providers'
import type { TradingOrder, TradingOrderRequest, TradingOrderType } from '@/providers/trading/types'
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

const orderSchema = z
  .object({
    provider: nonEmptyStringSchema,
    credentialId: nonEmptyStringSchema,
    environment: z.enum(['paper', 'live']),
    accountId: nonEmptyStringSchema,
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
  const fallback = provider.defaults?.timeInForce ?? timeInForceOptions[0]
  return fallback || errorResponse('timeInForce is required')
}

const resolveOrderType = (
  providerId: string,
  data: OrderRequestData
): { orderType: TradingOrderType; requires: string[] } | NextResponse => {
  const context = {
    listing: data.listing as ListingInputValue,
    orderClass: providerId === 'tradier' ? 'equity' : undefined,
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

const validateTradierSizing = (data: OrderRequestData): NextResponse | null => {
  if (data.orderSizingMode || hasNumber(data.notional)) {
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

const buildOrderRequest = (
  providerId: string,
  data: OrderRequestData,
  context: {
    accessToken: string
    accountId: string
    environment: 'paper' | 'live'
  },
  orderType: TradingOrderType,
  timeInForce: string
): TradingOrderRequest => {
  const usesLimitPrice = orderType === 'limit' || orderType === 'stop_limit'
  const usesStopPrice = orderType === 'stop' || orderType === 'stop_limit'
  const usesTrailValue = orderType === 'trailing_stop'
  const request: TradingOrderRequest = {
    kind: 'order',
    listing: data.listing as ListingInputValue,
    assetClass: resolveTradingListingAssetClass(data.listing as ListingInputValue),
    side: data.side,
    orderType,
    timeInForce,
    quantity: data.quantity,
    limitPrice: usesLimitPrice ? data.limitPrice : undefined,
    stopPrice: usesStopPrice ? data.stopPrice : undefined,
    trailPrice: usesTrailValue ? data.trailPrice : undefined,
    trailPercent: usesTrailValue ? data.trailPercent : undefined,
    environment: context.environment,
    accessToken: context.accessToken,
    accountId: context.accountId,
  }

  if (providerId === 'alpaca') {
    request.orderSizingMode = data.orderSizingMode ?? 'quantity'
    if (request.orderSizingMode === 'notional') {
      request.quantity = undefined
      request.notional = data.notional
    }
  }

  if (providerId === 'tradier') {
    request.providerParams = { orderClass: 'equity' }
  }

  return request
}

const toFetchBody = (body: string | Record<string, any> | undefined) => {
  if (typeof body === 'string' || body === undefined) return body
  return JSON.stringify(body)
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
    requestId,
    schema: orderSchema,
  })
  if (requestData instanceof Response) return requestData

  const baseContext = await resolveTradingProviderContext({
    requestData,
    requestId,
    operationKind: 'order',
  })
  if (baseContext instanceof Response) return baseContext

  const resolvedListingForRequest = requestData.listing as ListingInputValue
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

  const orderTypeResult = resolveOrderType(baseContext.providerId, requestData)
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
    accountId: requestData.accountId,
  })
  if (accountContext instanceof Response) return accountContext

  try {
    const provider = getTradingProvider(baseContext.providerId)
    const providerRequest = executeTradingProviderRequest(
      baseContext.providerId,
      buildOrderRequest(
        baseContext.providerId,
        requestData,
        {
          accessToken: baseContext.accessToken,
          accountId: accountContext.accountId,
          environment: baseContext.environment,
        },
        orderTypeResult.orderType,
        timeInForce
      )
    )

    const rawOrder = await fetchBrokerJson<unknown>({
      providerId: baseContext.providerId,
      url: providerRequest.url,
      init: {
        method: providerRequest.method,
        headers: providerRequest.headers,
        body: toFetchBody(providerRequest.body),
      },
    })

    const order = provider.normalizeOrder?.(rawOrder) ?? null

    const response: QuickOrderSubmitResponse = {
      order,
      provider: baseContext.providerId,
      environment: baseContext.environment,
      accountId: accountContext.accountId,
      message: extractOrderProviderMessage(rawOrder, order),
    }

    return NextResponse.json(response)
  } catch (error) {
    logBrokerRequestFailure('order', error)
    if (error instanceof TradingBrokerRequestError) {
      return errorResponse('Broker request failed', 502)
    }
    return errorResponse(error instanceof Error ? error.message : 'Order submission failed')
  }
}
