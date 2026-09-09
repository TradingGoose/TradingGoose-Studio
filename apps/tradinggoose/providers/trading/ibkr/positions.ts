import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrAccountUrl } from '@/providers/trading/ibkr/client'
import { ibkrTradingProviderConfig } from '@/providers/trading/ibkr/config'
import {
  fetchBrokerJson,
  sumFiniteNumbers,
  toFiniteNumber,
} from '@/providers/trading/portfolio-utils'
import type {
  TradingPortfolioBaseContext,
  UnifiedTradingPosition,
  UnifiedTradingSymbolAssetClass,
} from '@/providers/trading/types'
import { tradingSymbolToListingIdentity } from '@/providers/trading/utils'

export const IBKR_DEFAULT_BASE_CURRENCY = 'USD'

export const mapIbkrPositionSide = (
  value: unknown,
  quantity?: unknown
): UnifiedTradingPosition['side'] => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0) return 'long'
    if (value < 0) return 'short'
    return 'flat'
  }
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized === 'long' || normalized === 'l') return 'long'
  if (normalized === 'short' || normalized === 's') return 'short'
  if (normalized === 'flat' || normalized === 'f') return 'flat'

  if (typeof quantity === 'number' && Number.isFinite(quantity)) {
    if (quantity > 0) return 'long'
    if (quantity < 0) return 'short'
    return 'flat'
  }
  return 'unknown'
}

export const mapIbkrAssetClass = (value: unknown): UnifiedTradingSymbolAssetClass | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  switch (normalized) {
    case 'STK':
      return 'stock'
    case 'ETF':
      return 'etf'
    case 'FUT':
      return 'future'
    case 'CASH':
      return 'currency'
    case 'IND':
      return 'indice'
    case 'FUND':
    case 'MUTUALFUND':
      return 'mutualfund'
    case 'OPT':
      return 'future'
    default:
      return null
  }
}

const readText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export const normalizeIbkrPositions = (
  positions: unknown,
  context: Pick<TradingPortfolioBaseContext, 'credentialId' | 'serviceId' | 'providerId'>
): UnifiedTradingPosition[] => {
  const list = Array.isArray(positions) ? positions : []

  return list.flatMap((position: any) => {
    const assetClass = mapIbkrAssetClass(position?.assetClass)
    if (!assetClass) return []

    const symbolValue = readText(position?.ticker) || readText(position?.symbol)
    if (!symbolValue) return []

    const resolvedSymbol = tradingSymbolToListingIdentity(ibkrTradingProviderConfig, {
      symbol: symbolValue,
      assetClass,
      defaultQuote: IBKR_DEFAULT_BASE_CURRENCY,
    })
    const quote = resolvedSymbol?.quote ?? IBKR_DEFAULT_BASE_CURRENCY

    const side = mapIbkrPositionSide(position?.position)
    const rawQuantity = toFiniteNumber(position?.position) ?? 0
    const quantity = side === 'short' ? -Math.abs(rawQuantity) : rawQuantity
    const marketValue = toFiniteNumber(position?.mktValue)
    const unrealizedPnlPercent = toFiniteNumber(position?.unrealizedPnlPercent)
    const multiplier = toFiniteNumber(position?.multiplier) ?? 1

    return [
      {
        listingIdentity: resolvedSymbol?.listing ?? null,
        quantity,
        side,
        averagePrice: toFiniteNumber(position?.avgCost),
        marketPrice: toFiniteNumber(position?.mktPrice),
        marketValue,
        currencySymbol: quote === IBKR_DEFAULT_BASE_CURRENCY ? '$' : undefined,
        conversionRate: quote === IBKR_DEFAULT_BASE_CURRENCY ? 1 : undefined,
        unrealizedPnl: toFiniteNumber(position?.unrealizedPnl),
        unrealizedPnlPercent:
          typeof unrealizedPnlPercent === 'number' ? unrealizedPnlPercent * 100 : undefined,
        costBasis: toFiniteNumber(position?.costBasis),
        multiplier,
      },
    ]
  })
}

export const sumIbkrPositionUnrealizedPnl = (positions: UnifiedTradingPosition[]) =>
  sumFiniteNumbers(positions.map((position) => position.unrealizedPnl))

export async function getIbkrTradingPositions(
  context: TradingPortfolioBaseContext & { accountId: string }
): Promise<UnifiedTradingPosition[]> {
  const headers = buildIbkrAuthHeaders({ accessToken: context.accessToken })
  const allPositions: any[] = []

  let page = 0
  for (;;) {
    const response = await fetchBrokerJson<any[]>({
      providerId: context.providerId,
      url: buildIbkrAccountUrl(context.accountId, `/positions/${page}`),
      init: {
        method: 'GET',
        headers,
      },
    })

    const batch = Array.isArray(response) ? response : []
    allPositions.push(...batch)

    if (batch.length < 100 || batch.length === 0) break
    page += 1
  }

  return normalizeIbkrPositions(allPositions, context)
}
