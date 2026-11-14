'use client'

import type { CopilotToolContext } from '@/lib/copilot/native/contract'
import { readCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import { normalizeOptionalString } from '@/lib/utils'
import type { ChatContext } from './types'

/** Select the primary context for a new turn; the server resolves every tool's context. */
export function buildTurnProvenanceFromContexts(
  contexts: ChatContext[] | undefined,
  workspaceId: string | null | undefined
): CopilotToolContext | undefined {
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId)
  const provenance: CopilotToolContext = {
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
  }
  for (const context of contexts ?? []) {
    const entity = readCopilotWorkspaceEntityContext(context)
    if (!entity) continue
    if (entity.workspaceId && (!entity.current || !provenance.workspaceId))
      provenance.workspaceId = entity.workspaceId
    if (
      entity.entityKind !== 'dashboard_layout' &&
      entity.entityId &&
      !provenance.contextEntityId
    ) {
      provenance.contextEntityKind = entity.entityKind
      provenance.contextEntityId = entity.entityId
    }
  }
  return provenance.workspaceId || provenance.contextEntityId ? provenance : undefined
}
