import { z } from 'zod'
import { createEmptyMarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'
import {
  callRobinhoodTool,
  invalidRequest,
  numberValue,
  resolveRobinhoodListing,
  robinhoodError,
} from '@/providers/market/robinhood/client'
import type { MarketQuoteRequest } from '@/providers/market/types'

// Captured get_equity_quotes contract: current price uses the newest trade; daily change uses adjusted_previous_close.
// https://github.com/kevin1chun/robinhood-for-agents/blob/5478fae93025ea2f77e0419cbf26a16935c07fe8/docs/official-mcp-tools.json#L5257
const quoteSchema = z.object({
  symbol: z.string(),
  last_trade_price: numberValue,
  venue_last_trade_time: z.string(),
  last_non_reg_trade_price: numberValue.nullable(),
  venue_last_non_reg_trade_time: z.string().nullable(),
  adjusted_previous_close: numberValue,
  has_traded: z.boolean(),
  state: z.string(),
})
const responseSchema = z.object({
  data: z.object({
    results: z.array(z.object({ quote: quoteSchema.nullable() }).nullable()).nullable(),
  }),
})

export async function fetchRobinhoodQuote(request: MarketQuoteRequest) {
  if (!request.auth?.accessToken) invalidRequest('Robinhood connection is required')
  const { symbol } = await resolveRobinhoodListing(request.listing)
  const payload = await callRobinhoodTool(request.auth.accessToken, 'get_equity_quotes', {
    symbols: [symbol],
  })
  const result = responseSchema.safeParse(payload)
  if (!result.success) {
    throw robinhoodError('Robinhood returned invalid quote data', 502)
  }
  const quote = result.data.data.results?.find((row) => row?.quote?.symbol === symbol)?.quote
  if (!quote || !quote.has_traded || quote.state !== 'active')
    return createEmptyMarketQuoteSnapshot('Robinhood returned no active quote for this symbol')
  const lastPrice =
    quote.last_non_reg_trade_price !== null &&
    Date.parse(quote.venue_last_non_reg_trade_time ?? '') > Date.parse(quote.venue_last_trade_time)
      ? quote.last_non_reg_trade_price
      : quote.last_trade_price
  const previousClose = quote.adjusted_previous_close
  const change = lastPrice - previousClose
  return {
    lastPrice,
    previousClose,
    change,
    changePercent: previousClose !== 0 ? (change / previousClose) * 100 : null,
  }
}
