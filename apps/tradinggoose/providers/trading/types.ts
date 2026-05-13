import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import type { OAuthService } from '@/lib/oauth/oauth'
import type { AssetClass } from '@/providers/market/types'
import type { PortfolioDetail } from '@/providers/trading/portfolio-identity'
import type { HttpMethod } from '@/tools/types'

export type TradingProviderId = 'alpaca' | 'tradier' | (string & {})

export type TradingAuthType = 'oauth'

export type TradingOrderType =
  | 'market'
  | 'limit'
  | 'stop'
  | 'stop_limit'
  | 'trailing_stop'
  | 'debit'
  | 'credit'
  | 'even'

export interface TradingRequestConfig {
  url: string
  method: HttpMethod
  headers: Record<string, string>
  body?: Record<string, any> | string
}

export type TradingOperationKind = 'order' | 'holdings'

export interface TradingSymbolInput {
  listing?: ListingInputValue
  base?: string
  quote?: string
  assetClass?: AssetClass
  marketCode?: string
  countryCode?: string
  cityName?: string
}

export interface TradingOrderInput extends TradingSymbolInput {
  side: 'buy' | 'sell'
  clientOrderId?: string
  quantity?: number
  notional?: number
  orderSizingMode?: string
  orderType?: TradingOrderType
  timeInForce?: string
  limitPrice?: number
  stopPrice?: number
  trailPrice?: number
  trailPercent?: number
  orderClass?: string
  providerParams?: Record<string, any>
  environment?: 'paper' | 'live'
  accessToken?: string
  accountId?: string
}

export interface TradingHoldingsInput {
  environment?: 'paper' | 'live'
  accessToken?: string
  accountId?: string
}

export interface TradingOrderDetailInput extends TradingHoldingsInput {
  orderId: string
  provider?: TradingProviderId
}

export interface TradingOrderHistoryRecord {
  id: string
  workspaceId: string
  provider: string
  environment?: string | null
  submissionSource: 'manual' | 'copilot' | 'workflow'
  logId?: string | null
  request?: Record<string, any> | null
  response?: Record<string, any> | null
  normalizedOrder?: Record<string, any> | null
}

export interface TradingOrderDetailResult {
  providerOrderId: string
  orderDetail: Record<string, any>
}

export interface TradingPortfolioBaseContext {
  providerId: TradingProviderId
  credentialId: string
  serviceId: string
  environment?: 'paper' | 'live'
  accessToken: string
}

export interface TradingPortfolioAccountContext extends TradingPortfolioBaseContext {
  accountId: string
}

export interface TradingOrderRequest extends TradingOrderInput {
  kind: 'order'
}

export type UnifiedTradingEnvironment = 'live' | 'paper' | 'demo' | 'unknown'

export type UnifiedTradingAccountType = 'cash' | 'margin' | 'portfolio' | 'paper' | 'unknown'

export type UnifiedTradingAccountStatus = 'active' | 'restricted' | 'closed' | 'unknown'

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
  listing?: ListingIdentity
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

export type TradingPortfolioPerformanceWindow = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | 'MAX'

export interface UnifiedTradingPortfolioPerformancePoint {
  timestamp: string
  equity: number
}

export interface UnifiedTradingPortfolioPerformanceSummary {
  currency: string
  startEquity: number
  endEquity: number
  highEquity: number
  lowEquity: number
  absoluteReturn: number
  percentReturn: number | null
  asOf: string
}

export interface UnifiedTradingPortfolioPerformance {
  window: TradingPortfolioPerformanceWindow
  supportedWindows: TradingPortfolioPerformanceWindow[]
  series: UnifiedTradingPortfolioPerformancePoint[]
  summary: UnifiedTradingPortfolioPerformanceSummary | null
  unavailableReason?: string
}

export interface TradingOrder {
  id?: string
  clientOrderId?: string
  status?: string
  submittedAt?: string
  filledQty?: number
  symbol?: string
  side?: string
  raw: any
}

export interface TradingProviderOAuthConfig {
  provider: OAuthService
  services?: Array<{
    serviceId: OAuthService
    environment?: 'paper' | 'live'
  }>
  scopes?: string[]
  credentialTitle?: string
  credentialPlaceholder?: string
}

export interface TradingActionResponse {
  success: boolean
  output: {
    summary: string
    provider: TradingProviderId
    appOrderId?: string
    clientOrderId?: string
    order?: Record<string, any>
  }
  error?: string
}

export interface TradingHoldingsResponse {
  success: boolean
  output: {
    summary: string
    provider: TradingProviderId
    holdings: PortfolioDetail
  }
  error?: string
}
