import type { ListingInputValue } from '@/lib/listing/identity'
import type { OAuthService } from '@/lib/oauth/oauth'
import type { AssetClass } from '@/providers/market/types'
import type { HttpMethod } from '@/tools/types'

export type TradingProviderId = 'alpaca' | 'tradier' | (string & {})

export type TradingAuthType = 'apiKey' | 'oauth'

export type TradingOrderType =
  | 'market'
  | 'limit'
  | 'stop'
  | 'stop_limit'
  | 'trailing_stop'
  | 'debit'
  | 'credit'
  | 'even'

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
  listing?: ListingInputValue
  base?: string
  quote?: string
  assetClass?: AssetClass
  marketCode?: string
  countryCode?: string
  cityName?: string
  timeZoneName?: string
}

export interface TradingOrderInput extends TradingSymbolInput {
  symbol?: string
  side: 'buy' | 'sell'
  quantity?: number
  notional?: number
  orderSizingMode?: string
  orderType?: TradingOrderType
  timeInForce?: string
  limitPrice?: number
  stopPrice?: number
  trailPrice?: number
  trailPercent?: number
  environment?: 'paper' | 'live'
  accessToken?: string
  apiKey?: string
  apiSecret?: string
  orderClass?: string
  accountId?: string
  providerParams?: TradingProviderParams
}

export interface TradingHoldingsInput {
  environment?: 'paper' | 'live'
  accessToken?: string
  apiKey?: string
  apiSecret?: string
  accountId?: string
  providerParams?: TradingProviderParams
}

export interface TradingOrderDetailInput extends TradingHoldingsInput {
  orderId: string
  provider?: TradingProviderId
}

export interface TradingOrderHistoryRecord {
  id: string
  provider: string
  environment?: string | null
  workflowId?: string | null
  request?: Record<string, any> | null
  response?: Record<string, any> | null
  normalizedOrder?: Record<string, any> | null
}

export interface TradingOrderDetailResult {
  providerOrderId: string
  orderDetail: Record<string, any>
}

export interface TradingHoldingsNormalizationContext extends TradingHoldingsInput {
  providerId?: TradingProviderId
  providerName?: string
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

export type UnifiedTradingEnvironment = 'live' | 'paper' | 'demo' | 'unknown'

export type UnifiedTradingAccountType = 'cash' | 'margin' | 'portfolio' | 'paper' | 'unknown'

export type UnifiedTradingAccountStatus = 'active' | 'restricted' | 'closed' | 'unknown'

export interface UnifiedTradingProviderMetadata {
  name?: string
  environment?: UnifiedTradingEnvironment
}

export interface UnifiedTradingAccount {
  id: string
  name?: string
  type: UnifiedTradingAccountType
  baseCurrency: string
  status?: UnifiedTradingAccountStatus
}

export interface UnifiedTradingCashBalance {
  currency: string
  currencySymbol?: string
  amount: number
  conversionRate?: number
  amountInAccountCurrency?: number
}

export type UnifiedTradingSymbolAssetClass =
  | 'crypto'
  | 'currency'
  | 'etf'
  | 'future'
  | 'indice'
  | 'mutualfund'
  | 'stock'

export interface UnifiedTradingSymbol {
  base: string
  quote: string
  name?: string | null
  assetClass: UnifiedTradingSymbolAssetClass
  active: boolean
  rank: number
}

export type UnifiedTradingPositionSide = 'long' | 'short' | 'flat' | 'unknown'

export interface UnifiedTradingPosition {
  symbol: UnifiedTradingSymbol
  quantity: number
  side?: UnifiedTradingPositionSide
  averagePrice?: number
  marketPrice?: number
  marketValue?: number
  currencySymbol?: string
  conversionRate?: number
  unrealizedPnl?: number
  unrealizedPnlPercent?: number
  costBasis?: number
  multiplier?: number
  leverage?: number
  openedAt?: string
  updatedAt?: string
}

export type UnifiedTradingOrderType =
  | 'Market'
  | 'Limit'
  | 'StopMarket'
  | 'StopLimit'
  | 'TrailingStop'
  | 'MarketOnOpen'
  | 'MarketOnClose'
  | 'OptionExercise'
  | 'Other'

export type UnifiedTradingOrderStatus =
  | 'New'
  | 'Submitted'
  | 'PartiallyFilled'
  | 'Filled'
  | 'Canceled'
  | 'Invalid'
  | 'Expired'
  | 'Rejected'

export interface UnifiedTradingOrder {
  id: string
  clientOrderId?: string
  brokerIds?: string[]
  symbol: UnifiedTradingSymbol
  type: UnifiedTradingOrderType
  status: UnifiedTradingOrderStatus
  quantity: number
  filledQuantity?: number
  remainingQuantity?: number
  limitPrice?: number
  stopPrice?: number
  trailingAmount?: number
  trailingAsPercentage?: boolean
  priceCurrency?: string
  timeInForce?: string
  tag?: string
  createdTime: string
  lastUpdateTime?: string
  lastFillTime?: string
  averageFillPrice?: number
}

export interface UnifiedTradingAccountSummary {
  totalPortfolioValue: number
  totalCashValue: number
  totalHoldingsValue?: number
  totalUnrealizedPnl?: number
  totalRealizedPnl?: number
  totalFees?: number
  marginUsed?: number
  marginRemaining?: number
  buyingPower?: number
  equity?: number
  freePortfolioValue?: number
}

export interface UnifiedTradingAccountSnapshot {
  asOf: string
  provider?: UnifiedTradingProviderMetadata
  account: UnifiedTradingAccount
  cashBalances: UnifiedTradingCashBalance[]
  positions: UnifiedTradingPosition[]
  orders: UnifiedTradingOrder[]
  accountSummary: UnifiedTradingAccountSummary
  extra?: Record<string, any>
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

export type TradingProviderResponse = TradingOrder | UnifiedTradingAccountSnapshot

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
    holdings: UnifiedTradingAccountSnapshot
  }
  error?: string
}
