import { getAlpacaTradingAccounts } from '@/providers/trading/alpaca/accounts'
import { getAlpacaTradingAccountPerformance } from '@/providers/trading/alpaca/performance'
import { getAlpacaTradingAccountSnapshot } from '@/providers/trading/alpaca/snapshot'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { getTradingPortfolioDetailCapabilities } from '@/providers/trading/providers'
import {
  getRobinhoodTradingAccountSnapshot,
  getRobinhoodTradingAccounts,
} from '@/providers/trading/robinhood/portfolio'
import { getTradierTradingAccounts } from '@/providers/trading/tradier/accounts'
import { getTradierTradingAccountPerformance } from '@/providers/trading/tradier/performance'
import { getTradierTradingAccountSnapshot } from '@/providers/trading/tradier/snapshot'
import type {
  TradingPortfolioAccountContext,
  TradingPortfolioBaseContext,
  TradingPortfolioPerformanceWindow,
  TradingProviderId,
  UnifiedTradingPortfolioPerformance,
} from '@/providers/trading/types'

export const getTradingPortfolioSupportedWindows = (
  providerId: TradingProviderId
): TradingPortfolioPerformanceWindow[] => {
  return [...(getTradingPortfolioDetailCapabilities(providerId)?.performanceWindows ?? [])]
}

export const isTradingPortfolioWindowSupported = (providerId: TradingProviderId, window: string) =>
  getTradingPortfolioSupportedWindows(providerId).some(
    (supportedWindow) => supportedWindow === window
  )

export async function listPortfolioIdentities(
  context: TradingPortfolioBaseContext
): Promise<PortfolioIdentity[]> {
  switch (context.providerId) {
    case 'robinhood':
      return getRobinhoodTradingAccounts(context)
    case 'alpaca':
      return getAlpacaTradingAccounts(context)
    case 'tradier':
      return getTradierTradingAccounts(context)
    default:
      throw new Error(`Unsupported trading provider: ${context.providerId}`)
  }
}

export async function getPortfolioDetail(
  context: TradingPortfolioAccountContext & { portfolioIdentity: PortfolioIdentity }
): Promise<PortfolioDetail> {
  let detail: PortfolioDetail
  switch (context.providerId) {
    case 'robinhood':
      detail = await getRobinhoodTradingAccountSnapshot(context)
      break
    case 'alpaca':
      detail = await getAlpacaTradingAccountSnapshot(context)
      break
    case 'tradier':
      detail = await getTradierTradingAccountSnapshot(context)
      break
    default:
      throw new Error(`Unsupported trading provider: ${context.providerId}`)
  }
  detail.accountName = context.portfolioIdentity.accountName ?? detail.accountName
  detail.accountType ??= context.portfolioIdentity.accountType
  detail.accountStatus ??= context.portfolioIdentity.accountStatus
  return detail
}

export async function getTradingAccountPerformance(
  context: TradingPortfolioAccountContext & { window: TradingPortfolioPerformanceWindow }
): Promise<UnifiedTradingPortfolioPerformance> {
  switch (context.providerId) {
    case 'alpaca':
      return getAlpacaTradingAccountPerformance(context)
    case 'tradier':
      return getTradierTradingAccountPerformance(context)
    default:
      throw new Error(`Unsupported trading provider: ${context.providerId}`)
  }
}
