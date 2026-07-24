import type * as Y from 'yjs'
import { buildEntityListDescriptor } from '@/lib/copilot/review-sessions/identity'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { reseedEntityListSessionFromDb } from '@/lib/yjs/server/bootstrap-review-target'
import type { EntityListReadStore } from '@/lib/yjs/server/entity-loaders'
import { peekDocument, reconcileDocument, setDocumentReconciler } from './upstream-utils'

export function bindEntityListSession(
  doc: Y.Doc,
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): void {
  const reconcile = (readStore?: EntityListReadStore) =>
    reseedEntityListSessionFromDb(doc, entityKind, workspaceId, ownerUserId, readStore)
  setDocumentReconciler(doc, reconcile)
}

export async function refreshActiveEntityListSession(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<void> {
  const descriptor = buildEntityListDescriptor(entityKind, workspaceId, { ownerUserId })
  const doc = peekDocument(descriptor.yjsSessionId)
  if (!doc) return
  bindEntityListSession(doc, entityKind, workspaceId, ownerUserId)
  await reconcileDocument(doc, true)
}
