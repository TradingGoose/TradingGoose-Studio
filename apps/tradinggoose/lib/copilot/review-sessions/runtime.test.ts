/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  getReviewTargetRuntimeState,
  isReplaySafeReviewTarget,
} from '@/lib/copilot/review-sessions/runtime'

describe('review target runtime helpers', () => {
  it('marks docs with no reseed flag as replay safe', () => {
    const doc = new Y.Doc()

    expect(getReviewTargetRuntimeState(doc)).toEqual({
      docState: 'active',
      replaySafe: true,
      reseededFromCanonical: false,
    })
    expect(isReplaySafeReviewTarget(getReviewTargetRuntimeState(doc))).toBe(true)
  })

  it('marks reseeded docs as replay unsafe', () => {
    const doc = new Y.Doc()
    doc.getMap('metadata').set('reseededFromCanonical', true)

    expect(getReviewTargetRuntimeState(doc)).toEqual({
      docState: 'active',
      replaySafe: false,
      reseededFromCanonical: true,
    })
    expect(isReplaySafeReviewTarget(getReviewTargetRuntimeState(doc))).toBe(false)
  })

  it('preserves an expired bootstrap runtime when the doc has no docState metadata yet', () => {
    const doc = new Y.Doc()

    expect(
      getReviewTargetRuntimeState(doc, {
        docState: 'expired',
        replaySafe: false,
        reseededFromCanonical: false,
      })
    ).toEqual({
      docState: 'expired',
      replaySafe: false,
      reseededFromCanonical: false,
    })
  })
})
