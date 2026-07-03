import { describe, expect, it } from 'vitest'
import { readEntitySelectionState, resolveEntityIdFromList } from './entity-selection'

describe('entity id resolution', () => {
  it('uses linked pair entity id over stale widget params', () => {
    expect(
      readEntitySelectionState({
        pairContext: {
          skillId: 'skill-linked',
        },
        params: {
          skillId: 'skill-param',
        },
        entityIdKey: 'skillId',
      })
    ).toEqual({
      selectedEntityId: 'skill-linked',
    })
  })

  it('defaults only when no entity id was requested', () => {
    const entityIds = ['a', 'b']
    expect(
      resolveEntityIdFromList({ requestedEntityId: 'deleted', fallbackEntityId: 'a', entityIds })
    ).toBeNull()
    expect(resolveEntityIdFromList({ fallbackEntityId: 'b', entityIds })).toBe('b')
    expect(resolveEntityIdFromList({ entityIds })).toBe('a')
    expect(resolveEntityIdFromList({ entityIds, useDefaultEntity: false })).toBeNull()
  })
})
