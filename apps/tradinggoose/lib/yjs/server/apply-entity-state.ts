import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { applyEntityStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'

export async function applySavedEntityState(
  entityKind: SavedEntityKind,
  entityId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await applyEntityStateInSocketServer(entityId, entityKind, fields)
}
