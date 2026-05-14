import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { IdempotencyService } from '@/lib/idempotency'
import type { ListingInputValue } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import {
  authorizeTradingCredentialRequest,
  logTradingBrokerRequestFailure,
  resolveTradingProviderContext,
  resolveTradingProviderSelectedAccount,
} from '@/lib/trading/context'
import { TradingServiceError } from '@/lib/trading/errors'
import {
  recordOrderHistory,
  resolveOrderHistoryContext,
  updateOrderHistoryResult,
} from '@/lib/trading/order-history'
import type {
  TradingOrderSubmitRequest,
  TradingOrderSubmitResponse,
} from '@/lib/trading/order-types'
import { executeTradingProviderRequest, getTradingProviderAdapter } from '@/providers/trading'
import { resolveTradingListingIdentity } from '@/providers/trading/listing-resolution'
import {
  getStrictTradingOrderTypeDefinitions,
  getTradingOrderSizingModeDefinition,
  resolveTradingOrderSizingMode,
  resolveTradingOrderTimeInForce,
  resolveTradingOrderTypeDefinition,
  tradingOrderTypeUsesField,
} from '@/providers/trading/order-types'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import { fetchBrokerJson, TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import type { TradingOrderTypeDefinition } from '@/providers/trading/providers'
import { getTradingOrderCapabilities } from '@/providers/trading/providers'
import type { TradingOrder, TradingOrderType } from '@/providers/trading/types'
import {
  isTradingOrderListingSupported,
  resolveTradingListingAssetClass,
} from '@/providers/trading/utils'

const logger = createLogger('TradingOrders')
const tradingOrderIdempotency = new IdempotencyService({ namespace: 'trading-order' })

const createTradingOrderClientOrderId = (idempotencyKey: string) =>
  `tg-${createHash('sha256').update(idempotencyKey.trim()).digest('hex').slice(0, 32)}`

const hasNumber = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const resolveTimeInForce = (providerId: string, requested: string | undefined): string => {
  const requestedTimeInForce = requested?.trim()
  const timeInForce = resolveTradingOrderTimeInForce(providerId, requestedTimeInForce)
  if (timeInForce) return timeInForce
  if (requestedTimeInForce) {
    throw new TradingServiceError('Unsupported timeInForce for provider')
  }
  throw new TradingServiceError('timeInForce is required')
}

const resolveOrderType = (
  providerId: string,
  data: TradingOrderSubmitRequest,
  listing: ListingInputValue
): TradingOrderTypeDefinition => {
  const strictDefinitions = getStrictTradingOrderTypeDefinitions(providerId, {
    listing,
  })
  if (!strictDefinitions.length) {
    throw new TradingServiceError('No supported order types for listing')
  }

  const definition = resolveTradingOrderTypeDefinition(providerId, {
    listing,
    orderType: data.orderType,
  })
  if (!definition && data.orderType?.trim()) {
    throw new TradingServiceError('Unsupported order type')
  }
  return definition ?? strictDefinitions[0]
}

const validateRequiredNumber = (
  data: TradingOrderSubmitRequest,
  field: 'limitPrice' | 'stopPrice' | 'trailPrice' | 'trailPercent'
) => {
  if (!hasNumber(data[field])) {
    throw new TradingServiceError(`${field} is required`)
  }
}

const validateOrderSizing = (
  providerId: string,
  data: TradingOrderSubmitRequest,
  orderType: TradingOrderType,
  timeInForce: string
) => {
  const sizingMode = resolveTradingOrderSizingMode(providerId, data.orderSizingMode)
  if (data.orderSizingMode && !sizingMode) {
    throw new TradingServiceError('Unsupported order sizing mode')
  }
  const sizingDefinition = getTradingOrderSizingModeDefinition(providerId, sizingMode)
  if (!sizingMode || !sizingDefinition) {
    throw new TradingServiceError('Order sizing mode is required')
  }

  if (sizingMode === 'notional') {
    if (!hasNumber(data.notional)) throw new TradingServiceError('notional is required')
    if (sizingDefinition.orderTypes?.length && !sizingDefinition.orderTypes.includes(orderType)) {
      throw new TradingServiceError('Notional sizing is not supported for this order type')
    }
    if (
      sizingDefinition.timeInForce?.length &&
      !sizingDefinition.timeInForce.includes(timeInForce)
    ) {
      throw new TradingServiceError(
        `Notional sizing requires timeInForce=${sizingDefinition.timeInForce.join('/')}`
      )
    }
    return sizingMode
  }

  if (hasNumber(data.notional)) {
    throw new TradingServiceError('Notional sizing is not supported for selected order sizing mode')
  }
  if (!hasNumber(data.quantity)) {
    throw new TradingServiceError('quantity is required')
  }

  return sizingMode
}

const validateOrderFields = (
  providerId: string,
  data: TradingOrderSubmitRequest,
  orderType: TradingOrderType,
  orderTypeDefinition: TradingOrderTypeDefinition,
  timeInForce: string
): TradingOrderSubmitRequest['orderSizingMode'] => {
  const orderSizingMode = validateOrderSizing(providerId, data, orderType, timeInForce)
  if (data.preview && !getTradingOrderCapabilities(providerId)?.preview) {
    throw new TradingServiceError('Order preview is not supported for provider')
  }

  for (const field of orderTypeDefinition.excludes ?? []) {
    if (hasNumber(data[field])) {
      throw new TradingServiceError(`${field} is not supported for this order type`)
    }
  }

  const oneOfFields = orderTypeDefinition.requiresOneOf ?? []
  if (oneOfFields.length) {
    const providedCount = oneOfFields.filter((field) => hasNumber(data[field])).length
    if (providedCount !== 1) {
      throw new TradingServiceError(`${oneOfFields.join(' or ')} is required`)
    }
  }

  for (const field of orderTypeDefinition.requires ?? []) {
    if (
      field === 'limitPrice' ||
      field === 'stopPrice' ||
      field === 'trailPrice' ||
      field === 'trailPercent'
    ) {
      validateRequiredNumber(data, field)
    }
  }

  return orderSizingMode
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
  clientOrderId,
  accessToken,
  environment,
  orderTypeDefinition,
  timeInForce,
  orderSizingMode,
}: {
  providerId: string
  data: TradingOrderSubmitRequest
  listing: ListingInputValue
  accountId: string
  clientOrderId: string
  accessToken: string
  environment: 'paper' | 'live'
  orderTypeDefinition: TradingOrderTypeDefinition
  timeInForce: string
  orderSizingMode: TradingOrderSubmitRequest['orderSizingMode']
}) => {
  return executeTradingProviderRequest(providerId, {
    kind: 'order',
    accessToken,
    accountId,
    clientOrderId,
    environment,
    listing,
    side: data.side,
    quantity: orderSizingMode === 'notional' ? undefined : data.quantity,
    notional: orderSizingMode === 'notional' ? data.notional : undefined,
    orderSizingMode,
    orderType: orderTypeDefinition.id as TradingOrderType,
    timeInForce,
    limitPrice: tradingOrderTypeUsesField(orderTypeDefinition, 'limitPrice')
      ? data.limitPrice
      : undefined,
    stopPrice: tradingOrderTypeUsesField(orderTypeDefinition, 'stopPrice')
      ? data.stopPrice
      : undefined,
    trailPrice: tradingOrderTypeUsesField(orderTypeDefinition, 'trailPrice')
      ? data.trailPrice
      : undefined,
    trailPercent: tradingOrderTypeUsesField(orderTypeDefinition, 'trailPercent')
      ? data.trailPercent
      : undefined,
    preview: data.preview,
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
  request,
  requestData,
  requestId,
  userId,
}: {
  request: NextRequest
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
  const credentialAuthorization = await authorizeTradingCredentialRequest({
    request,
    credentialId: portfolioIdentity.credentialId,
    workspaceId: requestData.workspaceId,
    workflowId: requestData.workflowId,
  })

  const baseContext = await resolveTradingProviderContext({
    requestData: {
      provider: portfolioIdentity.providerId,
      credentialId: portfolioIdentity.credentialId,
      serviceId: portfolioIdentity.serviceId,
    },
    requestId,
    userId,
    credentialOwnerUserId: credentialAuthorization.credentialOwnerUserId,
    tokenAccountId: credentialAuthorization.tokenAccountId,
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

  const orderTypeDefinition = resolveOrderType(baseContext.providerId, requestData, resolvedListing)
  const timeInForce = resolveTimeInForce(baseContext.providerId, requestData.timeInForce)
  const orderSizingMode = validateOrderFields(
    baseContext.providerId,
    requestData,
    orderTypeDefinition.id as TradingOrderType,
    orderTypeDefinition,
    timeInForce
  )

  const accountContext = await resolveTradingProviderSelectedAccount({
    baseContext,
    accountId: portfolioIdentity.accountId,
  })
  const clientOrderId = createTradingOrderClientOrderId(requestData.idempotencyKey)
  const orderHistoryRequest = compactRecord({
    credentialId: baseContext.credentialId,
    serviceId: baseContext.serviceId,
    accountId: accountContext.accountId,
    clientOrderId,
    side: requestData.side,
    orderType: orderTypeDefinition.id,
    timeInForce,
    quantity: orderSizingMode === 'notional' ? undefined : requestData.quantity,
    notional: orderSizingMode === 'notional' ? requestData.notional : undefined,
    limitPrice: requestData.limitPrice,
    stopPrice: requestData.stopPrice,
    trailPrice: requestData.trailPrice,
    trailPercent: requestData.trailPercent,
    orderSizingMode,
    preview: requestData.preview,
  })
  return tradingOrderIdempotency.executeWithIdempotency(
    baseContext.providerId,
    requestData.idempotencyKey,
    async () => {
      const orderHistoryRecord = await recordOrderHistory({
        workspaceId: requestData.workspaceId,
        provider: baseContext.providerId,
        environment: baseContext.environment,
        submissionSource: orderHistoryContext.submissionSource,
        logId: orderHistoryContext.logId,
        listingIdentity,
        request: orderHistoryRequest,
        response: {
          success: false,
          status: 'pending',
          clientOrderId,
        },
      })

      let rawOrder: unknown
      let normalizedOrder: TradingOrder
      try {
        const providerRequest = buildOrderRequest({
          providerId: baseContext.providerId,
          data: requestData,
          listing: resolvedListing,
          accountId: accountContext.accountId,
          clientOrderId,
          accessToken: baseContext.accessToken,
          environment: baseContext.environment,
          orderTypeDefinition,
          timeInForce,
          orderSizingMode,
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
        const provider = getTradingProviderAdapter(baseContext.providerId)
        const providerOrder = provider.normalizeOrder
          ? provider.normalizeOrder(rawOrder)
          : ({ raw: rawOrder } as TradingOrder)
        normalizedOrder = {
          ...providerOrder,
          clientOrderId: providerOrder.clientOrderId ?? clientOrderId,
        }
      } catch (error) {
        logTradingBrokerRequestFailure('order', error)
        try {
          await updateOrderHistoryResult({
            id: orderHistoryRecord.id,
            workspaceId: requestData.workspaceId,
            response: compactRecord({
              success: false,
              clientOrderId,
              errorMessage: error instanceof Error ? error.message : 'Order submission failed',
              status: 'failed',
              httpStatus: error instanceof TradingBrokerRequestError ? error.status : undefined,
              raw:
                (error instanceof TradingBrokerRequestError && toRecord(error.payload)) ||
                toRecord(rawOrder),
            }),
          })
        } catch (recordError) {
          logger.error('Failed to update failed order history record', {
            appOrderId: orderHistoryRecord.id,
            error: recordError instanceof Error ? recordError.message : String(recordError),
          })
        }
        if (error instanceof TradingBrokerRequestError) {
          throw new TradingServiceError('Broker request failed', 502)
        }
        throw new TradingServiceError(
          error instanceof Error ? error.message : 'Order submission failed'
        )
      }

      const rawOrderRecord = toRecord(rawOrder)
      const normalizedOrderRecord = toRecord(normalizedOrder)
      let historyWarning: string | null = null
      try {
        await updateOrderHistoryResult({
          id: orderHistoryRecord.id,
          workspaceId: requestData.workspaceId,
          response: compactRecord({
            success: true,
            clientOrderId,
            orderId:
              normalizedOrderRecord?.id ?? rawOrderRecord?.id ?? rawOrderRecord?.order_id ?? null,
            raw: rawOrderRecord ?? normalizedOrderRecord,
          }),
          normalizedOrder: normalizedOrderRecord,
        })
      } catch (error) {
        historyWarning =
          'Order was accepted by the broker, but Trading Goose could not update order history.'
        logger.error('Failed to update accepted order history record', {
          appOrderId: orderHistoryRecord.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      return {
        appOrderId: orderHistoryRecord.id,
        clientOrderId,
        order: normalizedOrder,
        provider: baseContext.providerId,
        accountId: accountContext.accountId,
        message: extractOrderProviderMessage(rawOrder, normalizedOrder),
        historyWarning,
      }
    },
    {
      workspaceId: requestData.workspaceId,
      accountId: accountContext.accountId,
      userId,
    }
  )
}
