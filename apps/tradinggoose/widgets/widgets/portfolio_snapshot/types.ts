import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'

export interface PortfolioSnapshotWidgetParams {
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
  selectedWindow?: TradingPortfolioPerformanceWindow
  runtime?: {
    refreshAt?: number
  }
}
