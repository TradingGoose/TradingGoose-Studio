import type { ListingInputValue } from '@/lib/market/listings'
import type { OAuthService } from '@/lib/oauth/oauth'
import type { AssetClass } from '@/providers/market/types'
import type { HttpMethod } from '@/tools/types'

export type TradingProviderId = 'alpaca' | 'tradier' | 'robinhood' | (string & {})

export type TradingAuthType = 'apiKey' | 'oauth'

export interface TradingFieldDefinition {
  id: string
  label: string
  type: 'string' | 'number' | 'dropdown'
  for: 'order' | 'holdings' | 'both'
  required?: boolean
  placeholder?: string
  description?: string
  options?: { id: string; label: string }[]
}

export interface TradingRequestConfig {
  url: string
  method: HttpMethod
  headers: Record<string, string>
  body?: Record<string, any> | string
}

export const TRADING_OPERATION_KINDS = ['order', 'holdings'] as const
export type TradingOperationKind = (typeof TRADING_OPERATION_KINDS)[number]

export interface TradingSymbolInput {
  symbol?: string
  listing?: ListingInputValue
  base?: string
  quote?: string
  assetClass?: AssetClass
  micCode?: string
  countryCode?: string
  cityName?: string
  timeZoneName?: string
}

export interface TradingOrderInput extends TradingSymbolInput {
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  orderType?: string
  timeInForce?: string
  limitPrice?: number
  stopPrice?: number
  environment?: 'paper' | 'live'
  accessToken?: string
  apiKey?: string
  apiSecret?: string
  accountId?: string
  accountUrl?: string
  instrumentUrl?: string
  providerParams?: TradingProviderParams
}

export interface TradingHoldingsInput {
  environment?: 'paper' | 'live'
  accessToken?: string
  apiKey?: string
  apiSecret?: string
  accountId?: string
  accountUrl?: string
  providerParams?: TradingProviderParams
}

export interface TradingOrderRequest extends TradingOrderInput {
  kind: 'order'
}

export interface TradingHoldingsRequest extends TradingHoldingsInput {
  kind: 'holdings'
}

export type TradingProviderRequest = TradingOrderRequest | TradingHoldingsRequest

export interface TradingProviderParams {
  apiKey?: string
  apiSecret?: string
  accessToken?: string
  [key: string]: any
}

export interface TradingOrder {
  id?: string
  status?: string
  submittedAt?: string
  filledQty?: number
  symbol?: string
  side?: string
  raw: any
}

export interface TradingOpenPosition {
  symbol: string
  quantity: number
  avgPrice?: number
  marketValue?: number
  raw: any
}

export type TradingProviderResponse = TradingOrder | TradingOpenPosition[]

export interface TradingProviderOAuthConfig {
  provider: OAuthService
  serviceId?: OAuthService
  scopes?: string[]
  credentialTitle?: string
  credentialPlaceholder?: string
}

export interface TradingActionResponse {
  success: boolean
  output: {
    summary: string
    provider: TradingProviderId
    order?: Record<string, any>
  }
  error?: string
}

export interface TradingHoldingsResponse {
  success: boolean
  output: {
    summary: string
    provider: TradingProviderId
    holdings: Array<Record<string, any>>
  }
  error?: string
}
