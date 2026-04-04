import * as Y from 'yjs'
import type { ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'

export function getReviewTargetRuntimeState(doc: Y.Doc): ReviewTargetRuntimeState {
  const metadata = doc.getMap<unknown>('metadata')
  const reseededFromCanonical = metadata.get('reseededFromCanonical') === true

  return {
    docState: 'active',
    replaySafe: !reseededFromCanonical,
    reseededFromCanonical,
  }
}

export function isReplaySafeReviewTarget(
  runtime: ReviewTargetRuntimeState | null | undefined
): boolean {
  return runtime?.docState === 'active' && runtime.replaySafe === true
}
