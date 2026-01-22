import type {
  TradingOrder,
  TradingOrderInput,
  TradingRequestConfig,
} from '@/providers/trading/types'
import { resolveTradingSymbol } from '@/providers/trading/utils'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'
import { buildTradierAuthHeaders, resolveTradierBaseUrl } from '@/providers/trading/tradier/client'

const normalizeTradierOrderType = (value?: string) => {
  if (typeof value !== 'string' || !value.trim()) return 'market'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'stoplimit' || normalized === 'stop_limit' || normalized === 'stop-limit') {
    return 'stop_limit'
  }
  return normalized.replace(/[\s-]+/g, '_')
}

const normalizeTradierDuration = (value?: string) => {
  if (typeof value !== 'string' || !value.trim()) return 'day'
  return value.trim().toLowerCase()
}

const appendParamIfDefined = (params: URLSearchParams, key: string, value?: unknown) => {
  if (value === undefined || value === null || value === '') return
  params.append(key, String(value))
}

export const buildTradierOrderRequest = (
  params: TradingOrderInput
): TradingRequestConfig => {
  if (!params.accountId) {
    throw new Error('Tradier account ID is required')
  }

  const authHeaders = buildTradierAuthHeaders(params)
  const baseUrl = resolveTradierBaseUrl(params.environment)

  const symbol = resolveTradingSymbol(tradierTradingProviderConfig, {
    listing: params.listing,
    base: params.base,
    quote: params.quote,
    assetClass: params.assetClass,
    micCode: params.micCode,
    countryCode: params.countryCode,
    cityName: params.cityName,
    timeZoneName: params.timeZoneName,
  })

  const providerParams = params.providerParams ?? {}
  const orderClass = String(providerParams.orderClass || providerParams.class || 'equity')
  const duration = normalizeTradierDuration(providerParams.duration || params.timeInForce)
  const orderType = normalizeTradierOrderType(params.orderType)

  const bodyParams = new URLSearchParams({
    class: orderClass,
    symbol,
    side: params.side.toLowerCase(),
    quantity: String(params.quantity),
    type: orderType,
    duration,
  })

  appendParamIfDefined(bodyParams, 'price', params.limitPrice)
  appendParamIfDefined(bodyParams, 'stop', params.stopPrice)
  appendParamIfDefined(bodyParams, 'tag', providerParams.tag)
  appendParamIfDefined(bodyParams, 'preview', providerParams.preview)
  appendParamIfDefined(
    bodyParams,
    'option_symbol',
    providerParams.optionSymbol || providerParams.option_symbol
  )

  const legs = Array.isArray(providerParams.legs) ? providerParams.legs : []
  legs.forEach((leg: any, index: number) => {
    appendParamIfDefined(bodyParams, `side[${index}]`, leg?.side)
    appendParamIfDefined(bodyParams, `quantity[${index}]`, leg?.quantity)
    appendParamIfDefined(
      bodyParams,
      `option_symbol[${index}]`,
      leg?.optionSymbol || leg?.option_symbol
    )
  })

  return {
    url: `${baseUrl}/accounts/${params.accountId}/orders`,
    method: 'POST',
    headers: {
      ...authHeaders,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: bodyParams.toString(),
  }
}

export const normalizeTradierOrder = (data: any): TradingOrder => {
  const order = data?.order || data
  return {
    id: order?.id || order?.order?.id,
    status: order?.status,
    submittedAt:
      order?.create_date || order?.transaction_date || order?.date || order?.created_at,
    filledQty: order?.exec_quantity ? Number(order.exec_quantity) : undefined,
    symbol: order?.symbol,
    side: order?.side,
    raw: order || data,
  }
}
