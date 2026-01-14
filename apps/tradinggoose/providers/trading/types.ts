import type { OAuthService } from '@/lib/oauth/oauth'
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

export interface TradingProviderDefinition {
  id: TradingProviderId
  name: string
  description: string
  authType: TradingAuthType
  oauth?: {
    provider: OAuthService
    serviceId?: OAuthService
    scopes?: string[]
    credentialTitle?: string
    credentialPlaceholder?: string
  }
  credentialFields?: Array<{
    id: string
    label: string
    secret?: boolean
    description?: string
  }>
  fields?: TradingFieldDefinition[]
  defaults?: {
    orderType?: string
    timeInForce?: string
  }
  buildOrderRequest: (params: Record<string, any>) => TradingRequestConfig
  buildHoldingsRequest: (params: Record<string, any>) => TradingRequestConfig
  normalizeOrder?: (data: any) => {
    id?: string
    status?: string
    submittedAt?: string
    filledQty?: number
    symbol?: string
    side?: string
    raw: any
  }
  normalizeHoldings?: (data: any) => Array<{
    symbol: string
    quantity: number
    avgPrice?: number
    marketValue?: number
    raw: any
  }>
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
