import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  type CallToolResult,
  CallToolResultSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { ListingIdentity } from '@/lib/listing/identity'
import { MarketProviderError } from '@/providers/market/errors'
import { ROBINHOOD_MCP_URL, robinhoodProviderConfig } from '@/providers/market/robinhood/config'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'

type RobinhoodMarketTool = 'get_equity_historicals' | 'get_equity_quotes'
const REQUEST_TIMEOUT_MS = 30_000
const payloadSchema = z.record(z.string(), z.unknown())
export const numberValue = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(Number)
  .pipe(z.number().finite())

export function invalidRequest(message: string): never {
  throw new MarketProviderError({
    code: 'INVALID REQUEST',
    message,
    provider: 'robinhood',
    status: 400,
  })
}

export async function resolveRobinhoodListing(listing: ListingIdentity) {
  const context = await resolveListingContext(listing)
  if (
    !context.assetClass ||
    !['stock', 'etf'].includes(context.assetClass) ||
    (context.quote && context.quote !== 'USD') ||
    (context.countryCode && context.countryCode !== 'US')
  )
    invalidRequest('Robinhood market data supports US stocks and ETFs quoted in USD')
  const symbol = resolveProviderSymbol(robinhoodProviderConfig, context).trim().toUpperCase()
  if (!symbol) invalidRequest('Robinhood requires a stock symbol')
  return { context, symbol }
}

export const robinhoodError = (message: string, status?: number) =>
  new MarketProviderError({ code: 'PROVIDER ERROR', provider: 'robinhood', message, status })

export async function callRobinhoodTool(
  accessToken: string,
  tool: RobinhoodMarketTool,
  args: Record<string, unknown>,
  parentSignal?: AbortSignal
): Promise<unknown> {
  if (!accessToken.trim()) {
    throw robinhoodError('Reconnect Robinhood to authorize market data access.', 401)
  }

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout
  const client = new Client({ name: 'TradingGoose', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(ROBINHOOD_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
  })

  try {
    signal.throwIfAborted()
    await client.connect(transport, { signal })
    const result = (await client.callTool({ name: tool, arguments: args }, CallToolResultSchema, {
      signal,
    })) as CallToolResult
    signal.throwIfAborted()
    if (result.isError) {
      throw robinhoodError('Robinhood could not complete the market data request.')
    }

    // Robinhood returns its data envelope as structured content or JSON text.
    const content = result.content.find((item) => item.type === 'text')
    return payloadSchema.parse(result.structuredContent ?? JSON.parse(content?.text ?? 'null'))
  } catch (error) {
    if (signal.aborted || (error instanceof McpError && error.code === ErrorCode.RequestTimeout)) {
      throw robinhoodError('Robinhood market data request timed out.', 504)
    }
    if (error instanceof MarketProviderError) throw error
    if (
      error instanceof UnauthorizedError ||
      (error instanceof StreamableHTTPError && error.code === 401)
    ) {
      throw robinhoodError('Reconnect Robinhood to authorize market data access.', 401)
    }
    const status =
      error instanceof StreamableHTTPError && error.code && error.code >= 400 && error.code <= 599
        ? error.code
        : undefined
    // SDK transport errors can contain upstream bodies; never expose those to callers.
    throw robinhoodError('Unable to retrieve Robinhood market data.', status)
  } finally {
    await client.close().catch(() => undefined)
  }
}
