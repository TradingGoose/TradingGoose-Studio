import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSkillMetadata } from './skills-resolver'

const readSavedEntityFieldsForExecutionMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readSavedEntityFieldsForExecution: readSavedEntityFieldsForExecutionMock,
}))

describe('resolveSkillMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves selected skills in configured order and skips failures independently', async () => {
    readSavedEntityFieldsForExecutionMock.mockImplementation((_kind: string, skillId: string) => {
      if (skillId === 'skill-missing') return Promise.reject(new Error('temporarily unavailable'))
      return Promise.resolve({ description: `Description for ${skillId}` })
    })

    await expect(
      resolveSkillMetadata(
        [
          { skillId: 'skill-z', name: 'Zeta' },
          { skillId: 'skill-missing', name: 'Missing' },
          { skillId: 'skill-a', name: 'Alpha' },
        ],
        'workspace-1',
        true
      )
    ).resolves.toEqual([
      { id: 'skill-z', name: 'Zeta', description: 'Description for skill-z' },
      { id: 'skill-a', name: 'Alpha', description: 'Description for skill-a' },
    ])
    expect(readSavedEntityFieldsForExecutionMock.mock.calls).toEqual([
      ['skill', 'skill-z', 'workspace-1', true],
      ['skill', 'skill-missing', 'workspace-1', true],
      ['skill', 'skill-a', 'workspace-1', true],
    ])
  })
})
