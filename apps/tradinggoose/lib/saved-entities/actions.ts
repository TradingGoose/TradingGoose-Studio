'use server'

import { getSession } from '@/lib/auth'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import { renameSavedEntityIdentity } from '@/lib/saved-entities/identity'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'

export async function renameSavedEntityAction(input: {
  entityKind: SavedEntityKind
  entityId: string
  workspaceId: string
  name: string
}): Promise<{ name: string; updatedAt: Date }> {
  const userId = (await getSession())?.user?.id
  if (!userId) throw new Error('Unauthorized')

  const ownerUserId = input.entityKind === 'dashboard_layout' ? userId : null
  const access = await verifyReviewTargetAccess(
    userId,
    buildSavedEntityDescriptor(input.entityKind, input.entityId, input.workspaceId, {
      ownerUserId,
    }),
    'write'
  )
  if (!access.hasAccess || access.workspaceId !== input.workspaceId) {
    throw new Error('Access denied')
  }

  return renameSavedEntityIdentity({
    ...input,
    ownerUserId,
  })
}
