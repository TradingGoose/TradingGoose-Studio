import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadWorkspaceEntityMentionItems } from './workspace-entity-mentions'

const m = vi.hoisted(() => ({
  bootstrapYjsProvider: vi.fn(),
  dispose: vi.fn(),
  getEntityListMembers: vi.fn(),
}))

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: m.bootstrapYjsProvider,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  getEntityListMembers: m.getEntityListMembers,
}))

describe('loadWorkspaceEntityMentionItems Yjs lists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.bootstrapYjsProvider.mockResolvedValue({
      doc: {},
      dispose: m.dispose,
    })
  })

  it('maps watchlist mentions from the shared entity-list document', async () => {
    m.getEntityListMembers.mockReturnValueOnce([
      {
        entityId: 'watchlist-old',
        entityName: 'Old',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
      {
        entityId: 'watchlist-new',
        entityName: 'New',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
    ])

    await expect(loadWorkspaceEntityMentionItems('watchlist', 'workspace-1')).resolves.toEqual([
      expect.objectContaining({ entityKind: 'watchlist', id: 'watchlist-new', name: 'New' }),
      expect.objectContaining({ entityKind: 'watchlist', id: 'watchlist-old', name: 'Old' }),
    ])
    expect(m.bootstrapYjsProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        entityKind: 'watchlist',
        workspaceId: 'workspace-1',
        ownerUserId: null,
      }),
      undefined,
      'read'
    )
  })
})
