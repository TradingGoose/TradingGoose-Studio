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
import { ROBINHOOD_MCP_URL } from '@/lib/robinhood/constants'
import { MarketProviderError } from '@/providers/market/errors'

const READ_TOOLS = ['get_accounts', 'get_equity_historicals'] as const
const REQUEST_TIMEOUT_MS = 30_000
const payloadSchema = z.record(z.string(), z.unknown())
const accountsSchema = z.object({
  data: z.object({
    accounts: z
      .array(
        z.object({
          account_number: z.string().trim().min(1),
          is_default: z.boolean().optional(),
        })
      )
      .min(1),
  }),
})

const robinhoodError = (message: string, status?: number) =>
  new MarketProviderError({ code: 'PROVIDER ERROR', provider: 'robinhood', message, status })

export async function callRobinhoodTool(
  accessToken: string,
  tool: (typeof READ_TOOLS)[number],
  args: Record<string, unknown>
): Promise<unknown> {
  if (!READ_TOOLS.includes(tool)) {
    throw robinhoodError('Unsupported Robinhood market data tool.')
  }
  if (!accessToken.trim()) {
    throw robinhoodError('Reconnect Robinhood to authorize market data access.', 401)
  }

  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
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
    await client.connect(transport, { signal })
    const result = (await client.callTool({ name: tool, arguments: args }, CallToolResultSchema, {
      signal,
    })) as CallToolResult
    if (result.isError) {
      throw robinhoodError('Robinhood could not complete the market data request.')
    }

    // Robinhood returns its data envelope as structured content or JSON text.
    const content = result.content.find((item) => item.type === 'text')
    return payloadSchema.parse(result.structuredContent ?? JSON.parse(content?.text ?? 'null'))
  } catch (error) {
    if (error instanceof MarketProviderError) throw error
    if (
      error instanceof UnauthorizedError ||
      (error instanceof StreamableHTTPError && error.code === 401)
    ) {
      throw robinhoodError('Reconnect Robinhood to authorize market data access.', 401)
    }
    if (signal.aborted || (error instanceof McpError && error.code === ErrorCode.RequestTimeout)) {
      throw robinhoodError('Robinhood market data request timed out.', 504)
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

export async function getRobinhoodUserInfo(accessToken: string) {
  // Firsthand account shape: ssherman/robinhood-wizard, live verification notes §18.
  const result = accountsSchema.safeParse(await callRobinhoodTool(accessToken, 'get_accounts', {}))
  if (!result.success) {
    throw robinhoodError('Robinhood returned an invalid account profile.')
  }
  const defaults = result.data.data.accounts.filter((account) => account.is_default)
  if (defaults.length !== 1) {
    throw robinhoodError('Robinhood did not identify a unique default account.')
  }
  // This identifies the linked default brokerage account, not a person or login email.
  const accountNumber = defaults[0].account_number
  return {
    id: accountNumber,
    name: accountNumber,
    email: `${accountNumber}@robinhood.account`,
    image: '',
    emailVerified: false,
  }
}
