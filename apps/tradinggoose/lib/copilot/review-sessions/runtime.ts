import * as Y from 'yjs'
import type { ReviewTargetDocState, ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'

function isReviewTargetDocState(value: unknown): value is ReviewTargetDocState {
  return value === 'active' || value === 'expired'
}

export function getReviewTargetRuntimeState(
  doc: Y.Doc,
  baseRuntime?: ReviewTargetRuntimeState | null
): ReviewTargetRuntimeState {
  const metadata = doc.getMap<unknown>('metadata')
  const rawDocState = metadata.get('docState')
  const docState = isReviewTargetDocState(rawDocState)
    ? rawDocState
    : (baseRuntime?.docState ?? 'active')
  const reseededFromCanonical = metadata.get('reseededFromCanonical') === true

  return {
    docState,
    replaySafe: docState === 'active' && !reseededFromCanonical,
    reseededFromCanonical,
  }
}

export function isReplaySafeReviewTarget(
  runtime: ReviewTargetRuntimeState | null | undefined
): boolean {
  return runtime?.docState === 'active' && runtime.replaySafe === true
}
