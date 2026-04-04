/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveReviewSessionUndoRedoState } from '@/widgets/widgets/entity_review/review-session-controls'

describe('review session undo/redo controls', () => {
  it('disables undo and redo when there is no active session', () => {
    expect(resolveReviewSessionUndoRedoState(null)).toEqual({
      canUndo: false,
      canRedo: false,
      reviewControlsEnabled: false,
    })
  })

  it('disables undo and redo for replay-unsafe sessions', () => {
    expect(
      resolveReviewSessionUndoRedoState({
        runtime: {
          docState: 'active',
          replaySafe: false,
          reseededFromCanonical: true,
        },
        canUndo: true,
        canRedo: true,
      })
    ).toEqual({
      canUndo: false,
      canRedo: false,
      reviewControlsEnabled: false,
    })
  })

  it('enables undo and redo only when the runtime is replay safe and the stack allows it', () => {
    expect(
      resolveReviewSessionUndoRedoState({
        runtime: {
          docState: 'active',
          replaySafe: true,
          reseededFromCanonical: false,
        },
        canUndo: true,
        canRedo: false,
      })
    ).toEqual({
      canUndo: true,
      canRedo: false,
      reviewControlsEnabled: true,
    })
  })
})
