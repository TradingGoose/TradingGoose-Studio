import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockEq,
  mockSelect,
  mockInsert,
  mockTransaction,
  mockExecute,
  mockValues,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockEq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockTransaction: vi.fn(),
  mockExecute: vi.fn(),
  mockValues: vi.fn(),
}))

let systemAdminRows: Array<{ userId: string }> = []
let systemAdminCount = 0

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  systemAdmin: {
    id: 'system_admin.id',
    userId: 'system_admin.user_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => mockEq(left, right),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

describe('system admin access', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    systemAdminRows = []
    systemAdminCount = 0

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('system-admin-id'),
    })

    mockSelect.mockImplementation(() => {
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(systemAdminRows),
          })),
          limit: vi.fn().mockResolvedValue(
            systemAdminCount > 0 ? [{ userId: 'existing-admin' }] : []
          ),
        })),
      }
    })

    mockInsert.mockReturnValue({
      values: mockValues,
    })
    mockValues.mockResolvedValue(undefined)
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        execute: mockExecute,
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(
              systemAdminCount > 0 ? [{ userId: 'existing-admin' }] : []
            ),
          })),
        })),
        insert: vi.fn(() => ({
          values: mockValues,
        })),
      })
    )
    mockExecute.mockResolvedValue(undefined)
  })

  it('returns bootstrap access for an authenticated user when no system admin exists', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })

    const { getSystemAdminAccess } = await import('./access')
    const access = await getSystemAdminAccess()

    expect(access).toMatchObject({
      userId: 'user-1',
      isAuthenticated: true,
      isSystemAdmin: false,
      canBootstrapSystemAdmin: true,
    })
  })

  it('disables bootstrap access once a system admin already exists', async () => {
    systemAdminCount = 1
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })

    const { getSystemAdminAccess } = await import('./access')
    const access = await getSystemAdminAccess()

    expect(access).toMatchObject({
      userId: 'user-1',
      isAuthenticated: true,
      isSystemAdmin: false,
      canBootstrapSystemAdmin: false,
    })
  })

  it('claims the first system admin when the table is empty', async () => {
    const { claimFirstSystemAdmin } = await import('./access')
    const claimed = await claimFirstSystemAdmin('user-1')

    expect(claimed).toBe(true)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockValues).toHaveBeenCalledWith({
      id: 'system-admin-id',
      userId: 'user-1',
    })
  })

  it('refuses to claim a system admin after bootstrap has already completed', async () => {
    systemAdminCount = 1

    const { claimFirstSystemAdmin } = await import('./access')
    const claimed = await claimFirstSystemAdmin('user-1')

    expect(claimed).toBe(false)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockValues).not.toHaveBeenCalled()
  })
})
