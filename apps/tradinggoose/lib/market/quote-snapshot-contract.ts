export type MarketQuoteSnapshot = {
  lastPrice: number | null
  change: number | null
  changePercent: number | null
  previousClose: number | null
  volume?: number | null
  volumeUsd?: number | null
  lastPriceTime?: string
  timezone?: string
  regularSession?: { start: string; end: string }
  error?: string
}

export const MARKET_QUOTE_SNAPSHOT_REQUEST_CAP = 200

export const getMarketQuoteDate = (timestamp: string, timezone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(timestamp))
      .map(({ type, value }) => [type, value])
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const createMarketQuoteSnapshot = ({
  lastPrice = null,
  previousClose = null,
  volume,
  ...metadata
}: Partial<
  Omit<MarketQuoteSnapshot, 'change' | 'changePercent' | 'volumeUsd'>
>): MarketQuoteSnapshot => {
  const change = lastPrice !== null && previousClose !== null ? lastPrice - previousClose : null
  return {
    ...metadata,
    lastPrice,
    previousClose,
    change,
    changePercent:
      change !== null && previousClose !== null && previousClose !== 0
        ? (change / previousClose) * 100
        : null,
    ...(volume != null ? { volume } : {}),
    ...(volume != null && lastPrice !== null ? { volumeUsd: volume * lastPrice } : {}),
  }
}
