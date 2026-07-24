/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { getReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/runtime'

describe('review target runtime helpers', () => {
  it('defaults documents without state metadata to active', () => {
    const doc = new Y.Doc()

    expect(getReviewTargetRuntimeState(doc)).toEqual({
      docState: 'active',
    })
  })

  it('reads document state from metadata', () => {
    const doc = new Y.Doc()
    doc.getMap('metadata').set('docState', 'expired')

    expect(getReviewTargetRuntimeState(doc)).toEqual({
      docState: 'expired',
    })
  })
})
