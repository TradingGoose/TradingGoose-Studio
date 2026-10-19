import { toFiniteNumber } from '@/providers/trading/portfolio-utils'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'
import type { UnifiedTradingAccountType, UnifiedTradingPosition } from '@/providers/trading/types'
import { tradingSymbolToListingIdentity } from '@/providers/trading/utils'

export const TRADIER_DEFAULT_BASE_CURRENCY = 'USD'

export const getTradierCurrencySymbol = (currency?: string) => {
  switch (currency) {
    case 'USD':
      return '$'
    case 'EUR':
      return 'EUR'
    case 'GBP':
      return 'GBP'
    case 'JPY':
      return 'JPY'
    default:
      return undefined
  }
}

export const mapTradierAccountType = (value: unknown): UnifiedTradingAccountType => {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized === 'margin' || normalized === 'pdt') return 'margin'
  if (normalized === 'cash') return 'cash'
  return 'unknown'
}

export const extractTradierPositions = (data: any) => {
  const positions = data?.positions?.position
  if (Array.isArray(positions)) return positions
  if (!positions) return []
  return [positions]
}

export const extractTradierBalances = (data: any) => {
  const envelope = data?.balance ?? data
  const balances = envelope?.balances
  if (!balances || typeof balances !== 'object') return undefined

  return {
    ...balances,
    margin: balances.margin ?? envelope.margin,
    cash: balances.cash ?? envelope.cash,
    pdt: balances.pdt ?? envelope.pdt,
  }
}

export const normalizeTradierPositions = (positions: unknown): UnifiedTradingPosition[] => {
  const list = Array.isArray(positions) ? positions : []

  return list.map((position: any) => {
    const resolvedSymbol = tradingSymbolToListingIdentity(tradierTradingProviderConfig, {
      symbol: typeof position?.symbol === 'string' ? position.symbol : undefined,
      assetClass: 'stock',
      defaultQuote: TRADIER_DEFAULT_BASE_CURRENCY,
    })
    const quantity = toFiniteNumber(position?.quantity) ?? 0
    const costBasis = toFiniteNumber(position?.cost_basis)
    const averagePrice =
      typeof costBasis === 'number' && quantity !== 0 ? Math.abs(costBasis / quantity) : undefined
    const side = quantity === 0 ? 'flat' : quantity < 0 ? 'short' : 'long'
    const openedAt =
      typeof position?.date_acquired === 'string' ? position.date_acquired : undefined

    return {
      listingIdentity: resolvedSymbol?.listing ?? null,
      quantity,
      side,
      averagePrice,
      currencySymbol: getTradierCurrencySymbol(TRADIER_DEFAULT_BASE_CURRENCY),
      conversionRate: 1,
      costBasis,
      openedAt,
    }
  })
}
