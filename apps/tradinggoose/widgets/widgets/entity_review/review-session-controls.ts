'use client'

import { isReplaySafeReviewTarget } from '@/lib/copilot/review-sessions/runtime'
import {
  useRegisteredEntitySession,
  type RegisteredEntitySession,
} from '@/lib/yjs/entity-session-registry'

type UndoRedoSessionState = Pick<RegisteredEntitySession, 'runtime' | 'canUndo' | 'canRedo'>

export interface ReviewSessionUndoRedoState {
  canUndo: boolean
  canRedo: boolean
  reviewControlsEnabled: boolean
}

export function resolveReviewSessionUndoRedoState(
  session: UndoRedoSessionState | null | undefined
): ReviewSessionUndoRedoState {
  const reviewControlsEnabled = isReplaySafeReviewTarget(session?.runtime)

  return {
    canUndo: reviewControlsEnabled && session?.canUndo === true,
    canRedo: reviewControlsEnabled && session?.canRedo === true,
    reviewControlsEnabled,
  }
}

export function useReviewSessionUndoRedoState(
  reviewSessionId: string | null | undefined
): ReviewSessionUndoRedoState {
  const session = useRegisteredEntitySession(reviewSessionId)
  return resolveReviewSessionUndoRedoState(session)
}
