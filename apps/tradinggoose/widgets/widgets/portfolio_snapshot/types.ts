import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'

export interface PortfolioSnapshotWidgetParams {
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
  selectedWindow?: TradingPortfolioPerformanceWindow
  runtime?: {
    refreshAt?: number
  }
}
