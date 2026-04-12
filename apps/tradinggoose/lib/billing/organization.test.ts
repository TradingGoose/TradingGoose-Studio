/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnd, mockEq, mockInArray, mockSelect, mockSyncUsageLimits, mockTransaction } =
  vi.hoisted(() => ({
    mockAnd: vi.fn((...conditions: unknown[]) => conditions),
    mockEq: vi.fn((left: unknown, right: unknown) => ({ left, right, type: 'eq' })),
    mockInArray: vi.fn((field: unknown, values: unknown[]) => ({ field, type: 'inArray', values })),
    mockSelect: vi.fn(),
    mockSyncUsageLimits: vi.fn(),
    mockTransaction: vi.fn(),
  }))

let selectResults: unknown[] = []
let transactionUpdates: Array<{ table: unknown; values: unknown }> = []

function createAwaitableWhereResult(result: unknown) {
  const promise = Promise.resolve(result)

  return {
    limit: vi.fn().mockResolvedValue(result),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  member: {
    id: 'member.id',
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  organization: {
    id: 'organization.id',
    metadata: 'organization.metadata',
    name: 'organization.name',
    slug: 'organization.slug',
  },
  session: {
    id: 'session.id',
    activeOrganizationId: 'session.activeOrganizationId',
    userId: 'session.userId',
  },
  subscription: {
    id: 'subscription.id',
    referenceId: 'subscription.referenceId',
    referenceType: 'subscription.referenceType',
    status: 'subscription.status',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
    name: 'user.name',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => mockAnd(...conditions),
  eq: (left: unknown, right: unknown) => mockEq(left, right),
  inArray: (field: unknown, values: unknown[]) => mockInArray(field, values),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: (...args: unknown[]) => mockSyncUsageLimits(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('ensureOrganizationForOrganizationSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    selectResults = []
    transactionUpdates = []

    mockSelect.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createAwaitableWhereResult(selectResults.shift() ?? [])),
      })),
    }))

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        update: vi.fn((table: unknown) => ({
          set: vi.fn((values: unknown) => ({
            where: vi.fn(async () => {
              transactionUpdates.push({ table, values })
              return []
            }),
          })),
        })),
      })
    )
  })

  it('attaches to an organization the user can administer even if another membership is only member-level', async () => {
    selectResults.push(
      [
        { id: 'member-1', organizationId: 'org-member', role: 'member' },
        { id: 'member-2', organizationId: 'org-admin', role: 'admin' },
      ],
      []
    )

    const { ensureOrganizationForOrganizationSubscription } = await import('./organization')

    await expect(
      ensureOrganizationForOrganizationSubscription({
        id: 'sub-1',
        referenceId: 'user-1',
        referenceType: 'user',
        status: 'active',
        tier: { ownerType: 'organization' } as never,
      })
    ).resolves.toMatchObject({
      referenceId: 'org-admin',
      referenceType: 'organization',
    })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(transactionUpdates).toEqual([
      {
        table: expect.objectContaining({}),
        values: {
          referenceId: 'org-admin',
          referenceType: 'organization',
        },
      },
      {
        table: expect.objectContaining({}),
        values: {
          activeOrganizationId: 'org-admin',
        },
      },
    ])
  })

  it('uses another administrable organization when the first one already has an active subscription', async () => {
    selectResults.push(
      [
        { id: 'member-1', organizationId: 'org-admin-1', role: 'admin' },
        { id: 'member-2', organizationId: 'org-owner-2', role: 'owner' },
      ],
      [{ id: 'sub-existing', organizationId: 'org-admin-1' }]
    )

    const { ensureOrganizationForOrganizationSubscription } = await import('./organization')

    await expect(
      ensureOrganizationForOrganizationSubscription({
        id: 'sub-1',
        referenceId: 'user-1',
        referenceType: 'user',
        status: 'active',
        tier: { ownerType: 'organization' } as never,
      })
    ).resolves.toMatchObject({
      referenceId: 'org-owner-2',
      referenceType: 'organization',
    })
  })

  it('treats trialing organization subscriptions as blocking when selecting a target org', async () => {
    selectResults.push(
      [
        { id: 'member-1', organizationId: 'org-trialing', role: 'admin' },
        { id: 'member-2', organizationId: 'org-owner-2', role: 'owner' },
      ],
      [{ id: 'sub-existing', organizationId: 'org-trialing' }]
    )

    const { ensureOrganizationForOrganizationSubscription } = await import('./organization')

    await expect(
      ensureOrganizationForOrganizationSubscription({
        id: 'sub-1',
        referenceId: 'user-1',
        referenceType: 'user',
        status: 'active',
        tier: { ownerType: 'organization' } as never,
      })
    ).resolves.toMatchObject({
      referenceId: 'org-owner-2',
      referenceType: 'organization',
    })

    expect(mockInArray).toHaveBeenCalledWith(
      'subscription.status',
      expect.arrayContaining(['active', 'trialing', 'past_due'])
    )
  })

  it('rejects users who only belong to organizations they cannot administer', async () => {
    selectResults.push([{ id: 'member-1', organizationId: 'org-member', role: 'member' }])

    const { ensureOrganizationForOrganizationSubscription } = await import('./organization')

    await expect(
      ensureOrganizationForOrganizationSubscription({
        id: 'sub-1',
        referenceId: 'user-1',
        referenceType: 'user',
        status: 'active',
        tier: { ownerType: 'organization' } as never,
      })
    ).rejects.toThrow('User is already member of another organization')

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
