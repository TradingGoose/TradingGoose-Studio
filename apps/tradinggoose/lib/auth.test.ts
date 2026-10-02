import { genericOAuth } from 'better-auth/plugins'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  state: vi.fn(),
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}))
vi.mock('@tradinggoose/db', () => ({ db: mocks.db }))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn()
    close = vi.fn().mockResolvedValue(undefined)
    callTool = mocks.callTool
  },
}))
vi.mock('better-auth/api', async (original) => ({
  ...(await original<typeof import('better-auth/api')>()),
  getOAuthState: mocks.state,
}))
vi.mock('better-auth/plugins', async (original) => {
  const actual = await original<typeof import('better-auth/plugins')>()
  return { ...actual, genericOAuth: vi.fn(actual.genericOAuth) }
})

import './auth'

const config = vi
  .mocked(genericOAuth)
  .mock.calls[0][0].config.find((p) => p.providerId === 'robinhood')!
const getProfile = () => config.getUserInfo!({ accessToken: 'token' })

describe('Robinhood OAuth identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.db.limit.mockResolvedValue([])
    mocks.state.mockResolvedValue({ link: { userId: 'owner' } })
    mocks.callTool.mockResolvedValue({
      structuredContent: {
        data: {
          accounts: [
            { account_number: '12345678', is_default: false, deactivated: true },
            null,
            { account_number: '87654321', is_default: true },
          ],
        },
      },
      content: [],
    })
  })

  it('preserves the connected identity when the default brokerage account changes', async () => {
    mocks.db.limit.mockResolvedValue([{ accountId: '12345678' }])
    await expect(getProfile()).resolves.toMatchObject({ id: '12345678', name: 'Robinhood' })
    const query = new PgDialect().sqlToQuery(mocks.db.where.mock.calls[0][0])
    expect(query.params).toEqual(['robinhood', 'owner', '12345678', '87654321'])
  })

  it('rejects ambiguous existing mappings', async () => {
    mocks.db.limit.mockResolvedValue([{ accountId: '12345678' }, { accountId: '87654321' }])
    await expect(getProfile()).rejects.toThrow('multiple connected account identities')
  })

  it('requires a default after normalizing null accounts', async () => {
    const accounts = null
    mocks.callTool.mockResolvedValue({ structuredContent: { data: { accounts } }, content: [] })
    await expect(getProfile()).rejects.toThrow('unique default account')
  })

  it('requires an authenticated link owner', async () => {
    mocks.state.mockResolvedValue(null)
    await expect(getProfile()).rejects.toThrow('authenticated link')
    expect(mocks.db.select).not.toHaveBeenCalled()
  })
})
