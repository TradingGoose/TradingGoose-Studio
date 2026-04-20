import { describe, expect, it } from 'vitest'
import { buildImportedWorkflowSkillsLookup } from './workflow-create-menu.utils'

describe('workflow create menu skill lookup', () => {
  it('maps reordered imported skills by their original source name', () => {
    const lookup = buildImportedWorkflowSkillsLookup({
      expectedSkills: [{ name: 'Market Research' }, { name: 'Execution Plan' }],
      importedSkills: [
        {
          sourceName: 'Execution Plan',
          skillId: 'skill-2',
          name: 'Execution Plan (imported) 1',
        },
        {
          sourceName: 'Market Research',
          skillId: 'skill-1',
          name: 'Market Research',
        },
      ],
    })

    expect(lookup.get('Market Research')).toEqual({
      skillId: 'skill-1',
      name: 'Market Research',
    })
    expect(lookup.get('Execution Plan')).toEqual({
      skillId: 'skill-2',
      name: 'Execution Plan (imported) 1',
    })
  })

  it('rejects incomplete imported skill metadata', () => {
    expect(() =>
      buildImportedWorkflowSkillsLookup({
        expectedSkills: [{ name: 'Market Research' }],
        importedSkills: [],
      })
    ).toThrow('Failed to import workflow skills')
  })
})
