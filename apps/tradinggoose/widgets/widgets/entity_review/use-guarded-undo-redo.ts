import { useCallback } from 'react'
import { isReplaySafeReviewTarget } from '@/lib/copilot/review-sessions/runtime'
import type { ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'

interface UseGuardedUndoRedoOptions {
  runtime: ReviewTargetRuntimeState | null | undefined
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Wraps raw undo/redo callbacks with a guard that checks whether the
 * review-target runtime is replay-safe and whether undo/redo is available.
 *
 * All entity editors (custom-tool, skill, indicator, MCP) use the same
 * guard pattern; this hook deduplicates it.
 */
export function useGuardedUndoRedo({
  runtime,
  undo,
  redo,
  canUndo,
  canRedo,
}: UseGuardedUndoRedoOptions) {
  const handleUndo = useCallback(() => {
    if (!isReplaySafeReviewTarget(runtime) || !canUndo) {
      return
    }

    undo()
  }, [canUndo, runtime, undo])

  const handleRedo = useCallback(() => {
    if (!isReplaySafeReviewTarget(runtime) || !canRedo) {
      return
    }

    redo()
  }, [canRedo, redo, runtime])

  return { handleUndo, handleRedo }
}
