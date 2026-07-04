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

  it('skips unavailable selected skills without aborting agent startup', async () => {
    readSavedEntityFieldsForExecutionMock.mockImplementation(
      async (_entityKind, skillId: string) => {
        if (skillId === 'deleted-skill') {
          const error = new Error('Saved skill deleted-skill was not found')
          Object.assign(error, { status: 404 })
          throw error
        }

        return {
          name: 'Market Research',
          description: 'Research market setup before acting',
        }
      }
    )

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
  })
})
