import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  lease: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: { select: mocks.select, transaction: mocks.transaction },
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  withYjsSessionDeletionLease: mocks.lease,
  refreshEntityListSession: mocks.refresh,
}))

import { deleteSavedEntity, SAVED_ENTITY_LIST_LOCK_KINDS } from '@/lib/yjs/server/entity-loaders'

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  }
}

describe('deleteSavedEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses one shared lock-kind set for workspace entity lists', () => {
    expect(SAVED_ENTITY_LIST_LOCK_KINDS).toEqual(expect.arrayContaining(['workflow', 'watchlist']))
  })

  it.each(['skill', 'watchlist'] as const)(
    'does not lease %s outside the workspace',
    async (entityKind) => {
      const entityId = `${entityKind}-1`
      mocks.select.mockReturnValue(selectRows([{ workspaceId: 'workspace-2' }]))

      await expect(deleteSavedEntity(entityKind, entityId, 'workspace-1')).resolves.toBe(false)
      expect(mocks.lease).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['skill', 'delete'],
    ['knowledge_base', 'update'],
    ['watchlist', 'delete'],
  ] as const)('leases, locks, writes, and refreshes %s in order', async (entityKind, write) => {
    const entityId = `${entityKind}-1`
    const events: string[] = []
    mocks.select.mockReturnValue(selectRows([{ workspaceId: 'workspace-1' }]))
    mocks.lease.mockImplementation(async (_target, mutate) => {
      events.push('lease')
      return mutate()
    })
    const query = {
      where: () => ({
        returning: async () => {
          events.push(write)
          return [{ id: entityId }]
        },
      }),
    }
    mocks.transaction.mockImplementation(async (mutate) =>
      mutate({
        execute: async () => events.push('lock'),
        delete: () => query,
        update: () => ({ set: () => query }),
      })
    )
    mocks.refresh.mockImplementation(async () => void events.push('refresh'))

    await expect(deleteSavedEntity(entityKind, entityId, 'workspace-1')).resolves.toBe(true)
    expect(mocks.lease).toHaveBeenCalledWith({ sessionIds: [entityId] }, expect.any(Function))
    expect(events).toEqual(['lease', 'lock', write, 'refresh'])
  })
})
