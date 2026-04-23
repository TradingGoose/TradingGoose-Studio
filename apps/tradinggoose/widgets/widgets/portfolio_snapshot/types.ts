import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'

export interface PortfolioSnapshotWidgetParams {
  provider?: string
  credentialId?: string
  environment?: 'paper' | 'live'
  accountId?: string
  selectedWindow?: TradingPortfolioPerformanceWindow
  runtime?: {
    refreshAt?: number
  }
}
