import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { getEntityListMembers, replaceEntityListSessionMembers } from './entity-session'

describe('entity list sessions', () => {
  it('orders duplicate names deterministically by id', () => {
    const doc = new Y.Doc()
    try {
      replaceEntityListSessionMembers(doc, [
        { id: 'entity-b', name: 'Same' },
        { id: 'entity-a', name: 'Same' },
        { id: 'entity-c', name: 'Other' },
      ])

      expect(getEntityListMembers(doc).map((member) => member.entityId)).toEqual([
        'entity-c',
        'entity-a',
        'entity-b',
      ])
    } finally {
      doc.destroy()
    }
  })
})
