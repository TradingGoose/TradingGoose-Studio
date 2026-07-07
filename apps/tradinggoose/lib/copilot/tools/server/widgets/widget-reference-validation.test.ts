import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectRows = vi.fn()

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => selectRows()) })) })),
    })),
  },
}))

vi.mock('@tradinggoose/db/schema', () => {
  const table = (name: string, ...fields: string[]) =>
    Object.fromEntries(fields.map((field) => [field, `${name}.${field}`]))
  return {
    customTools: table('customTools', 'id', 'workspaceId'),
    mcpServers: table('mcpServers', 'id', 'workspaceId', 'deletedAt'),
    pineIndicators: table('pineIndicators', 'id', 'workspaceId'),
    skill: table('skill', 'id', 'workspaceId'),
    watchlistTable: table('watchlistTable', 'id', 'workspaceId', 'userId', 'parentId'),
    workflow: table('workflow', 'id', 'workspaceId'),
  }
})

const isNullMock = vi.fn((field) => ({ kind: 'isNull', field }))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
  isNull: isNullMock,
}))

vi.mock('@/lib/indicators/default/runtime', () => ({ DEFAULT_INDICATOR_RUNTIME_MAP: new Map() }))
vi.mock('@/lib/listing/resolve', () => ({ resolveListingIdentity: vi.fn() }))

const validateWatchlistReference = async (row: { id: string }) => {
  const { validateWidgetReferenceCandidates } = await import('./widget-reference-validation')
  selectRows.mockResolvedValueOnce([row])

  return validateWidgetReferenceCandidates(
    { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
    {
      panelId: 'panel-watchlist',
      afterWidget: { key: 'watchlist', pairColor: 'red', params: null },
      references: [
        {
          panelId: 'panel-watchlist',
          field: 'watchlistId',
          value: row.id,
          path: 'panel-watchlist.watchlistId',
        },
      ],
    }
  )
}

describe('widget reference validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts visible root watchlist document ids', async () => {
    await expect(
      validateWatchlistReference({ id: 'watchlist-visible' })
    ).resolves.toMatchObject({
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      panelId: 'panel-watchlist',
      widgetKey: 'watchlist',
    })
    expect(isNullMock).toHaveBeenCalledWith('watchlistTable.userId')
    expect(isNullMock).toHaveBeenCalledWith('watchlistTable.parentId')
  })

  it('rejects watchlist references that are not root watchlist documents', async () => {
    selectRows.mockResolvedValueOnce([])
    const { validateWidgetReferenceCandidates } = await import('./widget-reference-validation')

    await expect(
      validateWidgetReferenceCandidates(
        { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
        {
          panelId: 'panel-watchlist',
          afterWidget: { key: 'watchlist', pairColor: 'red', params: null },
          references: [
            {
              panelId: 'panel-watchlist',
              field: 'watchlistId',
              value: 'section-visible',
              path: 'panel-watchlist.watchlistId',
            },
          ],
        }
      )
    ).rejects.toThrow('Widget watchlistId reference "section-visible" is not accessible')
  })
})
