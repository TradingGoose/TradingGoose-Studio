import type * as Y from 'yjs'
import type {
  ReviewTargetDocState,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'

function isReviewTargetDocState(value: unknown): value is ReviewTargetDocState {
  return value === 'active' || value === 'expired'
}

export function getReviewTargetRuntimeState(doc: Y.Doc): ReviewTargetRuntimeState {
  const metadata = doc.getMap<unknown>('metadata')
  const rawDocState = metadata.get('docState')
  return {
    docState: isReviewTargetDocState(rawDocState) ? rawDocState : 'active',
  }
}
