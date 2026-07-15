import type * as Y from 'yjs'
import { buildEntityListDescriptor } from '@/lib/copilot/review-sessions/identity'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { reseedEntityListSessionFromDb } from '@/lib/yjs/server/bootstrap-review-target'
import { getExistingDocument, reconcileDocument, setDocumentReconciler } from './upstream-utils'

export function reconcileEntityListSession(
  doc: Y.Doc,
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<void> {
  setDocumentReconciler(doc, () =>
    reseedEntityListSessionFromDb(doc, entityKind, workspaceId, ownerUserId)
  )
  return reconcileDocument(doc, true)
}

export async function refreshActiveEntityListSession(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<Y.Doc | null> {
  const descriptor = buildEntityListDescriptor(entityKind, workspaceId, { ownerUserId })
  const doc = await getExistingDocument(descriptor.yjsSessionId)
  if (!doc) return null
  await reconcileEntityListSession(doc, entityKind, workspaceId, ownerUserId)
  return doc
}
