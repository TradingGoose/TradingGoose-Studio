import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  fenced: vi.fn(),
  refresh: vi.fn(),
  members: [] as Array<Record<string, unknown>>,
  events: [] as string[],
}))

vi.mock('@tradinggoose/db', () => ({ db: { select: mocks.select } }))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  runYjsDrainFencedTransaction: mocks.fenced,
  refreshEntityListSession: mocks.refresh,
}))

import { deleteSavedEntity } from '@/lib/yjs/server/entity-loaders'

const protectedKinds = ['skill', 'custom_tool', 'indicator', 'mcp_server', 'watchlist'] as const
const query = (read: () => unknown[]) => ({
  from: () => ({ where: () => ({ limit: read, orderBy: read }) }),
})
const member = (id: string) => ({
  id,
  settings: { showLogo: true, showTicker: true, showDescription: true },
})
const mutation = { where: () => ({ returning: async () => [{}] }) }
const protectedScenarios = protectedKinds.map(
  (entityKind) => [entityKind, [`${entityKind}-1`], 409, ['lock', 'read']] as const
)

describe('deleteSavedEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.members = []
    mocks.events = []
    mocks.select.mockReturnValue(query(() => [{ workspaceId: 'workspace-1' }]))
    mocks.fenced.mockImplementation((_target, mutate) =>
      mutate({
        execute: async () => void mocks.events.push('lock'),
        select: () =>
          query(() => {
            mocks.events.push('read')
            return mocks.members
          }),
        delete: () => mutation,
        update: () => ({ set: () => mutation }),
      })
    )
    mocks.refresh.mockImplementation(async () => void mocks.events.push('refresh'))
  })

  it.each([
    ...protectedScenarios,
    ['skill', ['skill-1', 'remaining'], true, ['lock', 'read', 'refresh']],
    ['skill', ['remaining'], false, ['lock', 'read']],
    ['knowledge_base', [], true, ['lock', 'refresh']],
  ] as const)(
    'enforces the locked %s deletion scenario',
    async (entityKind, ids, expected, events) => {
      mocks.members = ids.map(member)
      const deletion = deleteSavedEntity(entityKind, `${entityKind}-1`, 'workspace-1')
      if (expected === 409)
        await expect(deletion).rejects.toMatchObject({ status: 409, retryable: false })
      else await expect(deletion).resolves.toBe(expected)
      expect(mocks.events).toEqual(events)
    }
  )

  it('does not fence a target outside the workspace', async () => {
    mocks.select.mockReturnValue(query(() => [{ workspaceId: 'workspace-2' }]))
    await expect(deleteSavedEntity('skill', 'skill-1', 'workspace-1')).resolves.toBe(false)
    expect(mocks.fenced).not.toHaveBeenCalled()
  })
})
