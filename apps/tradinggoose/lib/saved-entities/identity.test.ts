/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renameSavedEntityIdentity } from '@/lib/saved-entities/identity'

const m = vi.hoisted(() => {
  const tables = {
    workflow: { id: 'workflow.id', workspaceId: 'workflow.workspaceId', name: 'workflow.name' },
    skill: { id: 'skill.id', workspaceId: 'skill.workspaceId', name: 'skill.name' },
    customTools: {
      id: 'customTools.id',
      workspaceId: 'customTools.workspaceId',
      title: 'customTools.title',
    },
    pineIndicators: {
      id: 'pineIndicators.id',
      workspaceId: 'pineIndicators.workspaceId',
      name: 'pineIndicators.name',
    },
    knowledgeBase: {
      id: 'knowledgeBase.id',
      workspaceId: 'knowledgeBase.workspaceId',
      deletedAt: 'knowledgeBase.deletedAt',
      name: 'knowledgeBase.name',
    },
    mcpServers: {
      id: 'mcpServers.id',
      workspaceId: 'mcpServers.workspaceId',
      deletedAt: 'mcpServers.deletedAt',
      name: 'mcpServers.name',
    },
    watchlistTable: {
      id: 'watchlistTable.id',
      workspaceId: 'watchlistTable.workspaceId',
      userId: 'watchlistTable.userId',
      parentId: 'watchlistTable.parentId',
      name: 'watchlistTable.name',
    },
    layoutMaps: {
      id: 'layoutMaps.id',
      workspaceId: 'layoutMaps.workspaceId',
      userId: 'layoutMaps.userId',
      name: 'layoutMaps.name',
    },
  }
  const state: {
    rows: Array<{ id: string }>
    error: unknown
    last: null | {
      table: unknown
      values: Record<string, unknown>
      condition: unknown
    }
  } = {
    rows: [{ id: 'entity-1' }],
    error: null,
    last: null,
  }
  const update = vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          state.last = { table, values, condition }
          if (state.error) throw state.error
          return state.rows
        },
      }),
    }),
  }))
  return {
    tables,
    state,
    update,
    refreshEntityListSession: vi.fn((..._args: unknown[]) => Promise.resolve()),
  }
})

vi.mock('@tradinggoose/db', () => ({ db: { update: m.update } }))
vi.mock('@tradinggoose/db/schema', () => m.tables)
vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ and: conditions.filter(Boolean) }),
  eq: (field: unknown, value: unknown) => ({ field, value }),
  isNull: (field: unknown) => ({ field, isNull: true }),
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  refreshEntityListSession: (...args: unknown[]) => m.refreshEntityListSession(...args),
}))

describe('renameSavedEntityIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.state.rows = [{ id: 'entity-1' }]
    m.state.error = null
    m.state.last = null
  })

  it.each([
    ['workflow', 'workflow', 'name', '  Workflow  ', 'Workflow', false],
    ['skill', 'skill', 'name', '  Skill  ', 'Skill', false],
    ['custom_tool', 'customTools', 'title', '  Custom   Tool  ', 'Custom Tool', false],
    ['indicator', 'pineIndicators', 'name', '  Indicator  ', 'Indicator', false],
    ['knowledge_base', 'knowledgeBase', 'name', '  Knowledge  ', 'Knowledge', true],
    ['mcp_server', 'mcpServers', 'name', '  MCP  ', 'MCP', true],
  ] as const)(
    'renames %s through its canonical row identity',
    async (entityKind, tableKey, identityField, inputName, expectedName, softDeleted) => {
      const table = m.tables[tableKey] as {
        id: string
        workspaceId: string
        deletedAt?: string
      }
      await expect(
        renameSavedEntityIdentity({
          entityKind,
          entityId: 'entity-1',
          workspaceId: 'workspace-1',
          name: inputName,
        })
      ).resolves.toBe(expectedName)

      expect(m.state.last).toMatchObject({
        table,
        values: { [identityField]: expectedName, updatedAt: expect.any(Date) },
        condition: {
          and: [
            { field: table.id, value: 'entity-1' },
            { field: table.workspaceId, value: 'workspace-1' },
            ...(softDeleted ? [{ field: table.deletedAt, isNull: true }] : []),
          ],
        },
      })
      expect(m.refreshEntityListSession).toHaveBeenCalledWith(entityKind, 'workspace-1', null)
    }
  )

  it('scopes watchlist identity to a workspace root folder', async () => {
    await renameSavedEntityIdentity({
      entityKind: 'watchlist',
      entityId: 'entity-1',
      workspaceId: 'workspace-1',
      name: 'Watchlist',
    })

    expect(m.state.last?.condition).toEqual({
      and: [
        { field: 'watchlistTable.id', value: 'entity-1' },
        { field: 'watchlistTable.workspaceId', value: 'workspace-1' },
        { field: 'watchlistTable.userId', isNull: true },
        { field: 'watchlistTable.parentId', isNull: true },
      ],
    })
  })

  it('scopes layout identity to the authenticated owner', async () => {
    await renameSavedEntityIdentity({
      entityKind: 'dashboard_layout',
      entityId: 'entity-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      name: 'Layout',
    })

    expect(m.state.last?.condition).toEqual({
      and: [
        { field: 'layoutMaps.id', value: 'entity-1' },
        { field: 'layoutMaps.workspaceId', value: 'workspace-1' },
        { field: 'layoutMaps.userId', value: 'user-1' },
      ],
    })
    expect(m.refreshEntityListSession).toHaveBeenCalledWith(
      'dashboard_layout',
      'workspace-1',
      'user-1'
    )
  })

  it('rejects missing layout ownership before writing', async () => {
    await expect(
      renameSavedEntityIdentity({
        entityKind: 'dashboard_layout',
        entityId: 'entity-1',
        workspaceId: 'workspace-1',
        name: 'Layout',
      })
    ).rejects.toMatchObject({ status: 400 })

    expect(m.update).not.toHaveBeenCalled()
  })

  it('maps missing rows and identity conflicts at the identity boundary', async () => {
    m.state.rows = []
    await expect(
      renameSavedEntityIdentity({
        entityKind: 'skill',
        entityId: 'missing',
        workspaceId: 'workspace-1',
        name: 'Skill',
      })
    ).rejects.toMatchObject({ status: 404 })

    m.state.rows = [{ id: 'entity-1' }]
    m.state.error = Object.assign(new Error('duplicate key'), { code: '23505' })
    await expect(
      renameSavedEntityIdentity({
        entityKind: 'skill',
        entityId: 'entity-1',
        workspaceId: 'workspace-1',
        name: 'Skill',
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('makes an accepted rename conditional on its reviewed identity', async () => {
    m.state.rows = []
    await expect(
      renameSavedEntityIdentity({
        entityKind: 'skill',
        entityId: 'entity-1',
        workspaceId: 'workspace-1',
        name: 'Renamed Skill',
        expectedCurrentName: 'Reviewed Skill',
      })
    ).rejects.toMatchObject({ status: 409, code: 'stale_server_tool_review' })

    expect(m.state.last?.condition).toEqual({
      and: [
        { field: 'skill.id', value: 'entity-1' },
        { field: 'skill.workspaceId', value: 'workspace-1' },
        { field: 'skill.name', value: 'Reviewed Skill' },
      ],
    })
  })
})
