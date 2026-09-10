import { createLogger } from '@/lib/logs/console/logger'
import { ibkrMarketProviderConfig } from '@/providers/market/ibkr/config'
import type {
  MarketBar,
  MarketSeries,
  MarketSeriesRequest,
} from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrApiUrl } from '@/providers/trading/ibkr/client'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'

const logger = createLogger('MarketProvider:IBKR')

const IBKR_RESOLUTION_MAP: Partial<Record<string, string>> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1hour',
  '1d': '1day',
  '1w': '1week',
  '1mo': '1month',
}

function resolveResolution(interval?: string): string {
  if (!interval) return '1day'
  return IBKR_RESOLUTION_MAP[interval] || '1day'
}

function toUnixSeconds(value?: string | number): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000)
    }
  }
  return undefined
}

function toIsoString(value?: string | number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 1e12 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return undefined
}

interface IbkrHistoryBar {
  t?: number | string
  o?: number
  h?: number
  l?: number
  c?: number
  v?: number
}

export async function fetchIbkrSeries(request: MarketSeriesRequest): Promise<MarketSeries> {
  const context = await resolveListingContext(request.listing)
  const symbol = resolveProviderSymbol(ibkrMarketProviderConfig, context)
  const resolution = resolveResolution(request.interval)
  const to = toUnixSeconds(request.end) || Math.floor(Date.now() / 1000)
  const from = toUnixSeconds(request.start) || to - 30 * 24 * 60 * 60

  const accessToken = request.auth?.accessToken
  if (!accessToken) {
    throw new Error('IBKR access token is required for market data')
  }

  const params = new URLSearchParams({
    symbol,
    conid: '0',
    resolution,
    from: String(from),
    to: String(to),
  })

  const url = `${buildIbkrApiUrl('/iserver/marketdata/history')}?${params.toString()}`

  logger.info('Fetching IBKR market series', {
    symbol,
    resolution,
    from,
    to,
  })

  const response = await fetchBrokerJson<IbkrHistoryBar[]>({
    providerId: 'ibkr',
    url,
    init: {
      method: 'GET',
      headers: buildIbkrAuthHeaders({ accessToken }),
    },
  })

  const bars: MarketBar[] = (response || [])
    .filter((bar): bar is IbkrHistoryBar => typeof bar === 'object')
    .map((bar) => ({
      timeStamp: toIsoString(bar.t) || new Date().toISOString(),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c ?? 0,
      volume: bar.v,
    }))
    .filter((bar) => bar.close !== undefined)

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    start: toIsoString(from * 1000),
    end: toIsoString(to * 1000),
    timezone: context.timeZoneName,
    normalizationMode: 'raw',
    bars,
  }
}
