import { createLogger } from '@/lib/logs/console/logger'
import { ibkrMarketProviderConfig } from '@/providers/market/ibkr/config'
import type { MarketBar, MarketLiveRequest, MarketLiveSnapshot } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrApiUrl } from '@/providers/trading/ibkr/client'
import { ensureIbkrSession } from '@/providers/trading/ibkr/session'
import { resolveIbkrConidFromApi } from '@/providers/trading/ibkr/symbols'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'

const logger = createLogger('MarketProvider:IBKR:Live')

/**
 * Snapshot field ids. IBKR returns these as string-keyed numbers.
 *   31 last, 70 high, 71 low, 84 bid, 86 ask, 87 volume
 */
const FIELDS = ['31', '70', '71', '84', '86', '87']

interface IbkrSnapshotRow {
  conid?: number
  _updated?: number
  '31'?: string | number
  '70'?: string | number
  '71'?: string | number
  '84'?: string | number
  '86'?: string | number
  '87'?: string | number
}

const toNumber = (value?: string | number): number | undefined => {
  if (value === undefined || value === null) return undefined
  // IBKR prefixes some values with markers such as 'C' (close) or 'H' (halted).
  const cleaned = typeof value === 'string' ? value.replace(/[^0-9.\-]/g, '') : value
  const parsed = typeof cleaned === 'number' ? cleaned : Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function fetchIbkrLiveSnapshot(
  request: MarketLiveRequest
): Promise<MarketLiveSnapshot> {
  const context = await resolveListingContext(request.listing)
  const symbol = resolveProviderSymbol(ibkrMarketProviderConfig, context)
  const accessToken = request.auth?.accessToken

  await ensureIbkrSession({ accessToken })

  const { conid } = await resolveIbkrConidFromApi({
    symbol,
    assetClass: context.assetClass,
    accessToken,
  })

  const url = `${buildIbkrApiUrl('/iserver/marketdata/snapshot')}?${new URLSearchParams({
    conids: String(conid),
    fields: FIELDS.join(','),
  }).toString()}`

  const headers = buildIbkrAuthHeaders({ accessToken })

  // IBKR primes the subscription on first call and frequently returns a row
  // without price fields; the immediate follow-up carries the data. One retry
  // is enough and avoids reporting a spurious "no data" to the widget.
  let rows = await fetchBrokerJson<IbkrSnapshotRow[]>({
    providerId: 'ibkr',
    url,
    init: { method: 'GET', headers },
  })
  if (!rows?.[0] || toNumber(rows[0]['31']) === undefined) {
    rows = await fetchBrokerJson<IbkrSnapshotRow[]>({
      providerId: 'ibkr',
      url,
      init: { method: 'GET', headers },
    })
  }

  const row = rows?.[0]
  const last = toNumber(row?.['31'])
  if (!row || last === undefined) {
    throw new Error(`IBKR returned no live quote for ${symbol} (conid ${conid})`)
  }

  const bar: MarketBar = {
    timeStamp: new Date(row._updated ?? Date.now()).toISOString(),
    open: undefined,
    high: toNumber(row['70']),
    low: toNumber(row['71']),
    close: last,
    volume: toNumber(row['87']),
  }

  logger.info('IBKR live snapshot', { symbol, conid, last })

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    interval: request.interval,
    timezone: context.timeZoneName,
    stream: request.stream,
    bar,
  }
}
