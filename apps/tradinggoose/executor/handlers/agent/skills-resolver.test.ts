import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSkillMetadata } from './skills-resolver'

const readSavedEntityFieldsForExecutionMock = vi.hoisted(() => vi.fn())
const readEntityListMembersFromDbMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readSavedEntityFieldsForExecution: readSavedEntityFieldsForExecutionMock,
}))
vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readEntityListMembersFromDb: readEntityListMembersFromDbMock,
}))

describe('resolveSkillMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readEntityListMembersFromDbMock.mockResolvedValue([
      { id: 'skill-z', name: 'Current Zeta' },
      { id: 'skill-a', name: 'Current Alpha' },
    ])
  })

  it('uses canonical names in configured order and skips failures independently', async () => {
    readSavedEntityFieldsForExecutionMock.mockImplementation((_kind: string, skillId: string) => {
      if (skillId === 'skill-missing') return Promise.reject(new Error('temporarily unavailable'))
      return Promise.resolve({ description: `Description for ${skillId}` })
    })

    await expect(
      resolveSkillMetadata(
        [
          { skillId: 'skill-z', name: 'Stale Zeta' },
          { skillId: 'skill-missing', name: 'Missing' },
          { skillId: 'skill-a' },
        ],
        'workspace-1',
        true
      )
    ).resolves.toEqual([
      { id: 'skill-z', name: 'Current Zeta', description: 'Description for skill-z' },
      { id: 'skill-a', name: 'Current Alpha', description: 'Description for skill-a' },
    ])
    expect(readEntityListMembersFromDbMock).toHaveBeenCalledWith('skill', 'workspace-1')
    expect(readSavedEntityFieldsForExecutionMock.mock.calls).toEqual([
      ['skill', 'skill-z', 'workspace-1', true],
      ['skill', 'skill-missing', 'workspace-1', true],
      ['skill', 'skill-a', 'workspace-1', true],
    ])

    readSavedEntityFieldsForExecutionMock.mockClear()
    readEntityListMembersFromDbMock.mockRejectedValueOnce(new Error('list unavailable'))

    await expect(
      resolveSkillMetadata([{ skillId: 'skill-z' }, { skillId: 'skill-a' }], 'workspace-1', true)
    ).resolves.toEqual([])
    expect(readSavedEntityFieldsForExecutionMock).toHaveBeenCalledTimes(2)
  })
})
