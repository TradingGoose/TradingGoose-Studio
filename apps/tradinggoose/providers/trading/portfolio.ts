import { getAlpacaTradingAccounts } from '@/providers/trading/alpaca/accounts'
import {
  ALPACA_SUPPORTED_TRADING_PORTFOLIO_WINDOWS,
  getAlpacaTradingAccountPerformance,
} from '@/providers/trading/alpaca/performance'
import { getAlpacaTradingAccountSnapshot } from '@/providers/trading/alpaca/snapshot'
import { getTradierTradingAccounts } from '@/providers/trading/tradier/accounts'
import {
  getTradierTradingAccountPerformance,
  TRADIER_SUPPORTED_TRADING_PORTFOLIO_WINDOWS,
} from '@/providers/trading/tradier/performance'
import { getTradierTradingAccountSnapshot } from '@/providers/trading/tradier/snapshot'
import type {
  TradingPortfolioAccountContext,
  TradingPortfolioBaseContext,
  TradingPortfolioPerformanceWindow,
  TradingProviderId,
  UnifiedTradingAccount,
  UnifiedTradingAccountSnapshot,
  UnifiedTradingPortfolioPerformance,
} from '@/providers/trading/types'

const TRADING_PORTFOLIO_SUPPORTED_WINDOWS: Record<string, TradingPortfolioPerformanceWindow[]> = {
  alpaca: [...ALPACA_SUPPORTED_TRADING_PORTFOLIO_WINDOWS],
  tradier: [...TRADIER_SUPPORTED_TRADING_PORTFOLIO_WINDOWS],
}

const TRADING_PORTFOLIO_DEFAULT_ENVIRONMENTS: Record<string, 'paper' | 'live'> = {
  alpaca: 'paper',
  tradier: 'live',
}

export const getTradingPortfolioSupportedWindows = (
  providerId: TradingProviderId
): TradingPortfolioPerformanceWindow[] => {
  return [...(TRADING_PORTFOLIO_SUPPORTED_WINDOWS[providerId] ?? [])]
}

export const getTradingPortfolioDefaultEnvironment = (
  providerId: TradingProviderId
): 'paper' | 'live' | undefined => TRADING_PORTFOLIO_DEFAULT_ENVIRONMENTS[providerId]

export const isTradingPortfolioWindowSupported = (providerId: TradingProviderId, window: string) =>
  getTradingPortfolioSupportedWindows(providerId).some(
    (supportedWindow) => supportedWindow === window
  )

export async function listTradingAccounts(
  context: TradingPortfolioBaseContext
): Promise<UnifiedTradingAccount[]> {
  switch (context.providerId) {
    case 'alpaca':
      return getAlpacaTradingAccounts(context)
    case 'tradier':
      return getTradierTradingAccounts(context)
    default:
      throw new Error(`Unsupported trading provider: ${context.providerId}`)
  }
}

export async function getTradingAccountSnapshot(
  context: TradingPortfolioAccountContext
): Promise<UnifiedTradingAccountSnapshot> {
  switch (context.providerId) {
    case 'alpaca':
      return getAlpacaTradingAccountSnapshot(context)
    case 'tradier':
      return getTradierTradingAccountSnapshot(context)
    default:
      throw new Error(`Unsupported trading provider: ${context.providerId}`)
  }
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
