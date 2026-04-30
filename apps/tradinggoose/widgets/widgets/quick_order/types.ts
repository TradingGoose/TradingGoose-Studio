export type QuickOrderSide = 'buy' | 'sell'

export interface QuickOrderWidgetParams {
  provider?: string
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: {
    apiKey?: string
    apiSecret?: string
    [key: string]: unknown
  }
  credentialId?: string
  environment?: 'paper' | 'live'
  accountId?: string
  side?: QuickOrderSide
}
