/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const tables = {
  account: { id: 'account.id', userId: 'account.userId' },
  credential: { id: 'credential.id', accountId: 'credential.accountId' },
  webhook: { provider: 'webhook.provider', providerConfig: 'webhook.providerConfig' },
}

describe('OAuth Disconnect API Route', () => {
  const mockGetSession = vi.fn()
  const mockLockCredentials = vi.fn()
  const mockDeleteWhere = vi.fn()
  const rows = new Map<unknown, unknown[]>()
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const createQuery = () => {
    let selectedRows: unknown[] = []
    const query: any = {
      from: vi.fn((table) => {
        selectedRows = rows.get(table) ?? []
        return query
      }),
      where: vi.fn(() => query),
      for: vi.fn(() => query),
      limit: vi.fn(async (count: number) => selectedRows.slice(0, count)),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(selectedRows).then(resolve, reject),
    }
    return query
  }
  const tx = {
    select: vi.fn(() => createQuery()),
    delete: vi.fn(() => ({ where: mockDeleteWhere })),
  }
  const mockDb = {
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    rows.clear()
    rows.set(tables.account, [{ id: 'account-row-1' }])
    rows.set(tables.credential, [])
    rows.set(tables.webhook, [])
    mockDeleteWhere.mockResolvedValue(undefined)

    vi.doMock('@/lib/auth', () => ({ getSession: mockGetSession }))
    vi.doMock('@tradinggoose/db', () => ({ db: mockDb }))
    vi.doMock('@tradinggoose/db/schema', () => tables)
    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      inArray: vi.fn((field, values) => ({ field, values, type: 'inArray' })),
    }))
    vi.doMock('@/lib/webhooks/webhook-helpers', () => ({
      getExternalSubscriptionCredentialIds: (owner: {
        providerConfig?: { credentialId?: string }
      }) => (owner.providerConfig?.credentialId ? [owner.providerConfig.credentialId] : []),
      lockExternalSubscriptionCredentials: (...args: unknown[]) => mockLockCredentials(...args),
    }))
    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))
  })

  afterEach(() => vi.clearAllMocks())

  it('locks credentials in stable order before deleting the owned account', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'user-123' } })
    rows.set(tables.credential, [{ id: 'credential-b' }, { id: 'credential-a' }])
    mockLockCredentials.mockResolvedValueOnce(undefined)

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')
    const response = await POST(createMockRequest('POST', { accountId: 'account-row-1' }))

    expect(response.status).toBe(200)
    expect(mockLockCredentials).toHaveBeenCalledWith(tx, ['credential-a', 'credential-b'])
    expect(tx.delete).toHaveBeenCalledWith(tables.account)
  })

  it('rejects disconnect while an external subscription owns a credential', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'user-123' } })
    rows.set(tables.credential, [{ id: 'credential-a' }])
    rows.set(tables.webhook, [
      { provider: 'airtable', providerConfig: { credentialId: 'credential-a' } },
    ])
    mockLockCredentials.mockResolvedValueOnce(undefined)

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')
    const response = await POST(createMockRequest('POST', { accountId: 'account-row-1' }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'EXTERNAL_SUBSCRIPTION_IN_USE' })
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it('treats an already missing account as disconnected', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'user-123' } })
    rows.set(tables.account, [])

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')
    const response = await POST(createMockRequest('POST', { accountId: 'missing' }))

    expect(response.status).toBe(200)
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')
    const response = await POST(createMockRequest('POST', { accountId: 'account-row-1' }))
    expect(response.status).toBe(401)
  })

  it('rejects a missing account id', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'user-123' } })
    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')
    const response = await POST(createMockRequest('POST', {}))
    expect(response.status).toBe(400)
  })

  it('sanitizes transaction failures', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'user-123' } })
    mockDb.transaction.mockRejectedValueOnce(new Error('database details'))
    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')
    const response = await POST(createMockRequest('POST', { accountId: 'account-row-1' }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error' })
  })
})
