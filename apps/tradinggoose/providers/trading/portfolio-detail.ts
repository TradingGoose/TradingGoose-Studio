import { resolveTradingListingIdentity } from '@/providers/trading/listing-resolution'
import type {
  PortfolioDetail,
  PortfolioEnvironment,
  PortfolioIdentity,
} from '@/providers/trading/portfolio-identity'
import type {
  UnifiedTradingAccountSummary,
  UnifiedTradingCashBalance,
  UnifiedTradingOrder,
  UnifiedTradingPosition,
} from '@/providers/trading/types'

const resolvePortfolioPositions = async (positions: UnifiedTradingPosition[]) =>
  Promise.all(
    positions.map(async (position) => {
      const listing = await resolveTradingListingIdentity(position.symbol)
      if (!listing) return position

      return {
        ...position,
        symbol: {
          ...position.symbol,
          listing,
        },
      }
    })
  )

export async function buildPortfolioDetail({
  identity,
  environment,
  asOf,
  cashBalances,
  positions,
  orders,
  summary,
}: {
  identity: PortfolioIdentity
  environment: PortfolioEnvironment
  asOf: string
  cashBalances: UnifiedTradingCashBalance[]
  positions: UnifiedTradingPosition[]
  orders?: UnifiedTradingOrder[]
  summary: UnifiedTradingAccountSummary
}): Promise<PortfolioDetail> {
  return {
    ...identity,
    environment,
    asOf,
    cashBalances,
    positions: await resolvePortfolioPositions(positions),
    orders: orders ?? [],
    summary,
  }
}
