import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSkillMetadata } from './skills-resolver'

const readSavedEntityListFieldsForExecutionMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readSavedEntityListFieldsForExecution: readSavedEntityListFieldsForExecutionMock,
}))

describe('resolveSkillMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips unavailable selected skills without aborting agent startup', async () => {
    readSavedEntityListFieldsForExecutionMock.mockResolvedValue([
      {
        entityId: 'skill-1',
        entityName: 'Market Research',
        fields: { description: 'Research market setup before acting' },
      },
    ])

    await expect(
      resolveSkillMetadata(
        [{ skillId: 'skill-1' }, { skillId: 'deleted-skill' }],
        'workspace-1',
        true
      )
    ).resolves.toEqual([
      {
        id: 'skill-1',
        name: 'Market Research',
        description: 'Research market setup before acting',
      },
    ])
    expect(readSavedEntityListFieldsForExecutionMock).toHaveBeenCalledWith(
      'skill',
      'workspace-1',
      true
    )
  })
})
