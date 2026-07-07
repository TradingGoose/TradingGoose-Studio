import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadWorkspaceEntityMentionItems } from './workspace-entity-mentions'

const m = vi.hoisted(() => ({
  bootstrapYjsProvider: vi.fn(),
  getEntityListMembers: vi.fn(),
  providerDisconnect: vi.fn(),
  providerDestroy: vi.fn(),
  docDestroy: vi.fn(),
}))

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: m.bootstrapYjsProvider,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  getEntityListMembers: m.getEntityListMembers,
}))

describe('loadWorkspaceEntityMentionItems dashboard layouts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.bootstrapYjsProvider.mockResolvedValue({
      doc: { destroy: m.docDestroy },
      provider: {
        disconnect: m.providerDisconnect,
        destroy: m.providerDestroy,
      },
    })
  })

  it('maps Yjs dashboard layout list members in tab order', async () => {
    m.getEntityListMembers.mockReturnValueOnce([
      {
        entityId: 'layout-b',
        entityName: 'Tie B',
        sortOrder: 1,
        isActive: false,
        createdAt: '2026-04-02T00:00:00.000Z',
      },
      {
        entityId: 'layout-c',
        entityName: 'Tie C',
        sortOrder: 1,
        isActive: false,
        createdAt: '2026-04-01T00:00:00.000Z',
      },
      {
        entityId: 'layout-a',
        entityName: 'Active',
        sortOrder: 0,
        isActive: true,
        createdAt: '2026-04-03T00:00:00.000Z',
      },
      {
        entityId: 'layout-d',
        entityName: 'Tie D',
        sortOrder: 1,
        isActive: false,
        createdAt: '2026-04-02T00:00:00.000Z',
      },
    ])

    await expect(
      loadWorkspaceEntityMentionItems('dashboard_layout', 'workspace-1', 'user-1')
    ).resolves.toEqual([
      expect.objectContaining({
        entityKind: 'dashboard_layout',
        id: 'layout-a',
        name: 'Active',
        ownerUserId: 'user-1',
        sortOrder: 0,
        isActive: true,
      }),
      expect.objectContaining({
        entityKind: 'dashboard_layout',
        id: 'layout-c',
        name: 'Tie C',
        ownerUserId: 'user-1',
        sortOrder: 1,
      }),
      expect.objectContaining({
        entityKind: 'dashboard_layout',
        id: 'layout-b',
        name: 'Tie B',
        ownerUserId: 'user-1',
        sortOrder: 1,
      }),
      expect.objectContaining({
        entityKind: 'dashboard_layout',
        id: 'layout-d',
        name: 'Tie D',
        ownerUserId: 'user-1',
        sortOrder: 1,
      }),
    ])
    expect(m.bootstrapYjsProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        entityKind: 'dashboard_layout',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
      }),
      undefined,
      'read'
    )
    expect(m.providerDisconnect).toHaveBeenCalled()
    expect(m.providerDestroy).toHaveBeenCalled()
    expect(m.docDestroy).toHaveBeenCalled()
  })

  it('returns no dashboard layout mentions without an owner scope', async () => {
    await expect(
      loadWorkspaceEntityMentionItems('dashboard_layout', 'workspace-1')
    ).resolves.toEqual([])
    expect(m.bootstrapYjsProvider).not.toHaveBeenCalled()
  })
})
