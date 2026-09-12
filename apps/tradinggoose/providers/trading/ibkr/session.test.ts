/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureIbkrSession,
  IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE,
  resetIbkrSessionState,
} from '@/providers/trading/ibkr/session'

// `vitest.setup.ts` installs a single global fetch mock for the whole file, so a
// per-test spy would accumulate its calls. Hoist one mock and clear it instead.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

const originalBaseUrl = process.env.IBKR_API_BASE_URL

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

interface Handlers {
  authStatus?: () => Response
  tickle?: () => Response
  accounts?: () => Response
}

const handlers: Handlers = {}

const callCount = (fragment: string) =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes(fragment)).length

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(handlers) as (keyof Handlers)[]) {
    delete handlers[key]
  }
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/iserver/auth/status')) {
      return (handlers.authStatus ?? (() => jsonResponse({ authenticated: true })))()
    }
    if (url.includes('/tickle')) {
      return (handlers.tickle ?? (() => jsonResponse({})))()
    }
    if (url.includes('/iserver/accounts')) {
      return (handlers.accounts ?? (() => jsonResponse({ accounts: ['DU123456'] })))()
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  process.env.IBKR_API_BASE_URL = 'http://host.containers.internal:5002/v1/api'
  resetIbkrSessionState()
})

afterEach(() => {
  vi.unstubAllGlobals()
  // `resolveIbkrApiBaseUrl` treats an empty value as unset, so assigning the
  // original (or an empty string) restores the real environment without the
  // delete operator, which lint rejects.
  process.env.IBKR_API_BASE_URL = originalBaseUrl ?? ''
})

describe('ensureIbkrSession', () => {
  it('reports an unauthenticated gateway as an instruction, not a bare status', async () => {
    handlers.accounts = () => jsonResponse({ error: 'not authenticated' }, 401)

    await expect(ensureIbkrSession()).rejects.toThrow(IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE)
  })

  it('reports an unauthenticated auth-status check with the same instruction', async () => {
    // The path an operator actually hits: auth/status answers 200 with
    // authenticated:false. It shares one message with the 401 path.
    handlers.authStatus = () =>
      jsonResponse({ authenticated: false, established: false, connected: false })

    await expect(ensureIbkrSession()).rejects.toThrow(IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE)
  })

  it('names no deployment-specific URL in the session message', async () => {
    // The gateway's scheme and port vary by deployment (this one is plain HTTP
    // behind a portproxy); a hardcoded URL once sent the operator to a port that
    // was not listening.
    expect(IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE).not.toMatch(/localhost|https?:\/\//)
  })

  it('re-primes on the next attempt after the session was rejected', async () => {
    handlers.accounts = () => jsonResponse({ error: 'not authenticated' }, 401)

    await expect(ensureIbkrSession()).rejects.toThrow(IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE)
    // A rejected session must not latch the module into a permanently
    // "primed" state once the operator logs in at the gateway.
    await expect(ensureIbkrSession()).rejects.toThrow(IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE)

    expect(callCount('/iserver/accounts')).toBe(2)
  })

  it('does not fail the caller when priming hits a transient non-auth error', async () => {
    // Observed live: /iserver/accounts answered 400 while the gateway was
    // mid-login, and the following market-data call succeeded.
    handlers.accounts = () => jsonResponse({ error: 'bad request' }, 400)

    await expect(ensureIbkrSession()).resolves.toBeUndefined()
  })

  it('retries priming for as long as it has not succeeded', async () => {
    handlers.accounts = () => jsonResponse({ error: 'bad request' }, 400)

    await ensureIbkrSession()
    // The tickle window has not elapsed, so only priming is attempted again.
    await ensureIbkrSession()

    expect(callCount('/iserver/accounts')).toBe(2)
    expect(callCount('/iserver/auth/status')).toBe(1)
  })

  it('primes once and reuses the session afterwards', async () => {
    await ensureIbkrSession()
    await ensureIbkrSession()

    expect(callCount('/iserver/accounts')).toBe(1)
    expect(callCount('/iserver/auth/status')).toBe(1)
    expect(callCount('/tickle')).toBe(1)
  })

  it('does nothing for the hosted OAuth API, which is stateless', async () => {
    process.env.IBKR_API_BASE_URL = 'https://api.ibkr.com/v1/api'

    await expect(ensureIbkrSession()).resolves.toBeUndefined()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
