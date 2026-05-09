import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'

export type QuickOrderSide = 'buy' | 'sell'

export interface QuickOrderWidgetParams {
  provider?: string
  credentialServiceId?: string
  portfolioIdentity?: PortfolioIdentity
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: {
    apiKey?: string
    apiSecret?: string
    [key: string]: unknown
  }
  side?: QuickOrderSide
}
