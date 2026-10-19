import { resolveTradingListingIdentity } from '@/providers/trading/listing-resolution'
import type {
  PortfolioDetail,
  PortfolioEnvironment,
  PortfolioIdentity,
} from '@/providers/trading/portfolio-identity'
import type {
  UnifiedTradingAccountSummary,
  UnifiedTradingCashBalance,
  UnifiedTradingPosition,
} from '@/providers/trading/types'

const resolvePortfolioPositions = async (positions: UnifiedTradingPosition[]) =>
  Promise.all(
    positions.map(async (position) => {
      const listingIdentity = position.listingIdentity
      const resolvedListingIdentity = listingIdentity
        ? await resolveTradingListingIdentity({ listing: listingIdentity })
        : null

      return {
        ...position,
        listingIdentity: resolvedListingIdentity ?? listingIdentity,
      }
    })
  )

export async function buildPortfolioDetail({
  identity,
  environment,
  asOf,
  cashBalances,
  positions,
  summary,
}: {
  identity: PortfolioIdentity
  environment: PortfolioEnvironment
  asOf: string
  cashBalances: UnifiedTradingCashBalance[]
  positions: UnifiedTradingPosition[]
  summary: UnifiedTradingAccountSummary
}): Promise<PortfolioDetail> {
  return {
    ...identity,
    environment,
    asOf,
    cashBalances,
    positions: await resolvePortfolioPositions(positions),
    summary,
  }
}
