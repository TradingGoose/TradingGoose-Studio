import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'

export interface PortfolioSnapshotWidgetParams {
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
  selectedWindow?: TradingPortfolioPerformanceWindow
  runtime?: {
    refreshAt?: number
  }
}
