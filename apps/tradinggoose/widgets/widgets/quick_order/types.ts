export type QuickOrderSide = 'buy' | 'sell'

export interface QuickOrderWidgetParams {
  provider?: string
  credentialId?: string
  environment?: 'paper' | 'live'
  accountId?: string
  side?: QuickOrderSide
}
