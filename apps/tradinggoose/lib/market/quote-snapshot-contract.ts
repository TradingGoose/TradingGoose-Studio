export type MarketQuoteSnapshot = {
  lastPrice: number | null
  change: number | null
  changePercent: number | null
  previousClose: number | null
  volume?: number | null
  volumeUsd?: number | null
  error?: string
}

export const MARKET_QUOTE_SNAPSHOT_REQUEST_CAP = 200
export const MARKET_QUOTE_SNAPSHOT_PROVIDER_BATCH_SIZE = 10

export const createEmptyMarketQuoteSnapshot = (error?: string): MarketQuoteSnapshot => ({
  lastPrice: null,
  change: null,
  changePercent: null,
  previousClose: null,
  ...(error ? { error } : {}),
})
