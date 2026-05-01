export type QuickOrderSide = 'buy' | 'sell'

export interface QuickOrderWidgetParams {
  provider?: string
  credentialServiceId?: string
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: {
    apiKey?: string
    apiSecret?: string
    [key: string]: unknown
  }
  accountId?: string
  side?: QuickOrderSide
}
