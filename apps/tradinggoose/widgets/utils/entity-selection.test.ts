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

  it('recovers stale requested ids only when default selection is enabled', () => {
    const entityIds = ['a', 'b']
    expect(
      resolveEntityIdFromList({ requestedEntityId: 'deleted', fallbackEntityId: 'a', entityIds })
    ).toBe('a')
    expect(
      resolveEntityIdFromList({
        requestedEntityId: 'deleted',
        entityIds,
        useDefaultEntity: false,
      })
    ).toBeNull()
    expect(resolveEntityIdFromList({ fallbackEntityId: 'b', entityIds })).toBe('b')
    expect(resolveEntityIdFromList({ entityIds })).toBe('a')
    expect(resolveEntityIdFromList({ entityIds, useDefaultEntity: false })).toBeNull()
  })
})
