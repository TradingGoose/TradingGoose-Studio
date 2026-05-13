import { describe, expect, it } from 'vitest'
import { readEntitySelectionState } from './resolve-entity-id'

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
})
