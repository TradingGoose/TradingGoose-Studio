import type { ListingInputValue } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import {
  logTradingBrokerRequestFailure,
  resolveTradingProviderContext,
  resolveTradingProviderSelectedAccount,
} from '@/lib/trading/context'
import { TradingServiceError } from '@/lib/trading/errors'
import { recordOrderHistory, resolveOrderHistoryContext } from '@/lib/trading/order-history'
import type {
  TradingOrderSubmitRequest,
  TradingOrderSubmitResponse,
} from '@/lib/trading/order-types'
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

const hasNumber = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const getTimeInForceOptions = (providerId: string) =>
  getTradingProviderConfig(providerId)?.capabilities?.order?.timeInForce ?? []

const resolveTimeInForce = (providerId: string, requested: string | undefined): string => {
  const timeInForceOptions = getTimeInForceOptions(providerId)
  const requestedTimeInForce = requested?.trim()

  if (requestedTimeInForce) {
    if (!timeInForceOptions.includes(requestedTimeInForce)) {
      throw new TradingServiceError('Unsupported timeInForce for provider')
    }
    return requestedTimeInForce
  }

  const provider = getTradingProvider(providerId)
  const defaultTimeInForce = provider.defaults?.timeInForce ?? timeInForceOptions[0]
  if (!defaultTimeInForce) {
    throw new TradingServiceError('timeInForce is required')
  }
  return defaultTimeInForce
}

const resolveOrderType = (
  providerId: string,
  data: TradingOrderSubmitRequest,
  listing: ListingInputValue
): { orderType: TradingOrderType; requires: string[] } => {
  const strictDefinitions = getStrictTradingOrderTypeDefinitions(providerId, { listing })
  if (!strictDefinitions.length) {
    throw new TradingServiceError('No supported order types for listing')
  }

  const requestedOrderType = data.orderType?.trim()
  if (requestedOrderType) {
    const requestedDefinition = strictDefinitions.find(
      (definition) => definition.id === requestedOrderType
    )
    if (!requestedDefinition) {
      throw new TradingServiceError('Unsupported order type')
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
  data: TradingOrderSubmitRequest,
  field: 'limitPrice' | 'stopPrice' | 'trailPrice' | 'trailPercent'
) => {
  if (!hasNumber(data[field])) {
    throw new TradingServiceError(`${field} is required`)
  }
}

const validateAlpacaSizing = (
  data: TradingOrderSubmitRequest,
  orderType: TradingOrderType,
  timeInForce: string
) => {
  const sizingMode = data.orderSizingMode ?? 'quantity'
  if (sizingMode === 'notional') {
    if (!hasNumber(data.notional)) throw new TradingServiceError('notional is required')
    const orderTypeError = getAlpacaNotionalOrderTypeError(orderType)
    if (orderTypeError) throw new TradingServiceError(orderTypeError)
    if (timeInForce !== 'day') {
      throw new TradingServiceError('Alpaca notional orders require timeInForce=day')
    }
    return
  }

  if (!hasNumber(data.quantity)) {
    throw new TradingServiceError('quantity is required')
  }
}

const getOrderSizingMode = (providerId: string, data: TradingOrderSubmitRequest) =>
  providerId === 'alpaca' ? (data.orderSizingMode ?? 'quantity') : undefined

const validateTradierSizing = (data: TradingOrderSubmitRequest) => {
  if (data.orderSizingMode === 'notional' || hasNumber(data.notional)) {
    throw new TradingServiceError('Notional sizing is only supported for Alpaca')
  }
  if (!hasNumber(data.quantity)) {
    throw new TradingServiceError('quantity is required')
  }
}

const validateOrderFields = (
  providerId: string,
  data: TradingOrderSubmitRequest,
  orderType: TradingOrderType,
  requires: string[],
  timeInForce: string
) => {
  providerId === 'alpaca'
    ? validateAlpacaSizing(data, orderType, timeInForce)
    : validateTradierSizing(data)

  if (providerId === 'alpaca' && orderType === 'trailing_stop') {
    const hasTrailPrice = hasNumber(data.trailPrice)
    const hasTrailPercent = hasNumber(data.trailPercent)
    if (hasNumber(data.limitPrice) || hasNumber(data.stopPrice)) {
      throw new TradingServiceError(
        'Alpaca trailing stop orders do not accept limitPrice or stopPrice'
      )
    }
    if (hasTrailPrice === hasTrailPercent) {
      throw new TradingServiceError(ALPACA_TRAILING_STOP_TRAIL_VALUE_ERROR)
    }
    return
  }

  for (const field of requires) {
    if (
      field === 'limitPrice' ||
      field === 'stopPrice' ||
      field === 'trailPrice' ||
      field === 'trailPercent'
    ) {
      validateRequiredNumber(data, field)
    }
  }
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

const resolveOrderListing = async (listing: ListingInputValue): Promise<ListingInputValue> => {
  const record = toRecord(listing)
  if (record && hasResolvedListingDetails(record)) return listing

  const identity = toListingValueObject(listing)
  if (!identity) throw new TradingServiceError('Resolved listing is required')

  const tradingIdentity = await resolveTradingListingIdentity({
    listing: identity,
    base: readRecordText(record, 'base'),
    quote: readRecordText(record, 'quote'),
    assetClass: resolveTradingListingAssetClass(listing),
  }).catch(() => null)
  if (!tradingIdentity) {
    throw new TradingServiceError('Unable to resolve listing details for order')
  }

  const resolved = await resolveListingIdentity(tradingIdentity).catch(() => null)
  if (!resolved) {
    throw new TradingServiceError('Unable to resolve listing details for order')
  }
  return resolved
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
  data: TradingOrderSubmitRequest
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

export async function submitTradingOrder({
  requestData,
  requestId,
  userId,
}: {
  requestData: TradingOrderSubmitRequest
  requestId: string
  userId: string
}): Promise<TradingOrderSubmitResponse> {
  const portfolioIdentity = toPortfolioValueObject(requestData.portfolioIdentity)
  if (!portfolioIdentity) {
    throw new TradingServiceError('portfolioIdentity is required')
  }

  const workspaceAccess = await checkWorkspaceAccess(requestData.workspaceId, userId)
  if (!workspaceAccess.exists || !workspaceAccess.canWrite) {
    throw new TradingServiceError('Not found', 404)
  }

  const orderHistoryContext = await resolveOrderHistoryContext({
    workspaceId: requestData.workspaceId,
    submissionSource: requestData.submissionSource,
    logId: requestData.logId,
  })

  const baseContext = await resolveTradingProviderContext({
    requestData: {
      provider: portfolioIdentity.providerId,
      credentialId: portfolioIdentity.credentialId,
      credentialServiceId: portfolioIdentity.credentialServiceId,
    },
    requestId,
    userId,
  })

  const resolvedListing = await resolveOrderListing(requestData.listing as ListingInputValue)
  const listingIdentity = toListingValueObject(resolvedListing)
  if (!listingIdentity) {
    throw new TradingServiceError('Resolved listing is required')
  }

  const assetClass = resolveTradingListingAssetClass(resolvedListing)
  if (!assetClass) {
    throw new TradingServiceError('Resolved listing asset class is required')
  }

  if (!isTradingOrderListingSupported(baseContext.providerId, resolvedListing)) {
    throw new TradingServiceError('Unsupported listing for provider')
  }

  const orderTypeResult = resolveOrderType(baseContext.providerId, requestData, resolvedListing)
  const timeInForce = resolveTimeInForce(baseContext.providerId, requestData.timeInForce)
  validateOrderFields(
    baseContext.providerId,
    requestData,
    orderTypeResult.orderType,
    orderTypeResult.requires,
    timeInForce
  )

  const accountContext = await resolveTradingProviderSelectedAccount({
    baseContext,
    accountId: portfolioIdentity.accountId,
  })
  const orderSizingMode = getOrderSizingMode(baseContext.providerId, requestData)
  const orderHistoryRequest = compactRecord({
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
  })

  let rawOrder: unknown
  let normalizedOrder: TradingOrder
  try {
    const providerRequest = buildOrderRequest({
      providerId: baseContext.providerId,
      data: requestData,
      listing: resolvedListing,
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
    logTradingBrokerRequestFailure('order', error)
    await recordOrderHistory({
      workspaceId: requestData.workspaceId,
      provider: baseContext.providerId,
      environment: baseContext.environment,
      submissionSource: orderHistoryContext.submissionSource,
      logId: orderHistoryContext.logId,
      listingIdentity,
      request: orderHistoryRequest,
      response: compactRecord({
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Order submission failed',
        status: error instanceof TradingBrokerRequestError ? error.status : undefined,
        raw:
          (error instanceof TradingBrokerRequestError && toRecord(error.payload)) ||
          toRecord(rawOrder),
      }),
    })
    if (error instanceof TradingBrokerRequestError) {
      throw new TradingServiceError('Broker request failed', 502)
    }
    throw new TradingServiceError(
      error instanceof Error ? error.message : 'Order submission failed'
    )
  }

  const rawOrderRecord = toRecord(rawOrder)
  const normalizedOrderRecord = toRecord(normalizedOrder)
  const orderHistoryRecord = await recordOrderHistory({
    workspaceId: requestData.workspaceId,
    provider: baseContext.providerId,
    environment: baseContext.environment,
    submissionSource: orderHistoryContext.submissionSource,
    logId: orderHistoryContext.logId,
    listingIdentity,
    request: orderHistoryRequest,
    response: {
      success: true,
      orderId: normalizedOrderRecord?.id ?? rawOrderRecord?.id ?? rawOrderRecord?.order_id ?? null,
      raw: rawOrderRecord ?? normalizedOrderRecord,
    },
    normalizedOrder: normalizedOrderRecord,
  })

  return {
    appOrderId: orderHistoryRecord.id,
    order: normalizedOrder,
    provider: baseContext.providerId,
    accountId: accountContext.accountId,
    message: extractOrderProviderMessage(rawOrder, normalizedOrder),
  }
}
