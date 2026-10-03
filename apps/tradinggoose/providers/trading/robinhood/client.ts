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
import { TradingBrokerRequestError, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import { ROBINHOOD_MCP_URL } from '@/providers/trading/robinhood/config'

const TOOLS = [
  'get_accounts',
  'get_portfolio',
  'get_equity_positions',
  'get_equity_orders',
  'review_equity_order',
  'place_equity_order',
] as const
type TradingTool = (typeof TOOLS)[number]
type CallTool = (
  tool: TradingTool,
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>
const envelope = z.object({ data: z.record(z.string(), z.unknown()) })
export const robinhoodNumber = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(toFiniteNumber)
  .pipe(z.number().finite())

export async function withRobinhoodTradingClient<T>(
  accessToken: string | undefined,
  operation: (call: CallTool) => Promise<T>
): Promise<T> {
  if (!accessToken?.trim()) throw new Error('Robinhood connection is required.')
  // One deadline for the entire operation, below the trading socket's 20-second timeout.
  const signal = AbortSignal.timeout(15_000)
  const client = new Client({ name: 'TradingGoose', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(ROBINHOOD_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
  })
  let submissionStarted = false
  try {
    await client.connect(transport, { signal })
    return await operation(async (tool, args) => {
      if (!TOOLS.includes(tool)) throw new Error('Unsupported Robinhood trading tool.')
      if (tool === 'place_equity_order') submissionStarted = true
      const result = (await client.callTool({ name: tool, arguments: args }, CallToolResultSchema, {
        signal,
      })) as CallToolResult
      if (result.isError) {
        submissionStarted = false
        throw new Error('Robinhood tool request failed.')
      }
      const text = result.content.find((item) => item.type === 'text')
      return envelope.parse(result.structuredContent ?? JSON.parse(text?.text ?? 'null')).data
    })
  } catch (error) {
    if (error instanceof TradingBrokerRequestError) throw error
    const unauthorized =
      error instanceof UnauthorizedError ||
      (error instanceof StreamableHTTPError && error.code === 401)
    const timedOut =
      signal.aborted || (error instanceof McpError && error.code === ErrorCode.RequestTimeout)
    throw new TradingBrokerRequestError({
      providerId: 'robinhood',
      url: ROBINHOOD_MCP_URL,
      status: unauthorized ? 401 : timedOut ? 504 : 502,
      submissionUnknown: submissionStarted,
      message: unauthorized
        ? 'Reconnect Robinhood.'
        : timedOut
          ? 'Robinhood request timed out. An order submission may still have completed.'
          : 'Robinhood returned an unsuccessful or invalid trading response.',
    })
  } finally {
    await client.close().catch(() => undefined)
  }
}
