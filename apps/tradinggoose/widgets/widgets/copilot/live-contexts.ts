import { normalizeOptionalString } from '@/lib/utils'
import type { ChatContext } from '@/stores/copilot/types'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import {
  buildCopilotWorkspaceEntityContext,
  COPILOT_WORKSPACE_ENTITY_CONFIGS,
  getCopilotWorkspaceEntityIdFromPairContext,
} from './workspace-entities'

type BuildImplicitCopilotContextsOptions = {
  workspaceId?: string | null
  pairContext?: PairColorContext | null
}

export function resolveCopilotWorkflowId(
  pairContext?: PairColorContext | null
): string | undefined {
  return getCopilotWorkspaceEntityIdFromPairContext(pairContext, 'workflow') ?? undefined
}

export const buildImplicitCopilotContexts = ({
  workspaceId,
  pairContext,
}: BuildImplicitCopilotContextsOptions): ChatContext[] => {
  // These contexts describe what the user is looking at right now. They are sent
  // with each turn, but they do not mount or select editable review sessions.
  const resolvedWorkspaceId = normalizeOptionalString(workspaceId)
  const contexts: ChatContext[] = []

  for (const config of COPILOT_WORKSPACE_ENTITY_CONFIGS) {
    const entityId = getCopilotWorkspaceEntityIdFromPairContext(pairContext, config.entityKind)
    if (!entityId) {
      continue
    }

    contexts.push(
      buildCopilotWorkspaceEntityContext({
        entityKind: config.entityKind,
        entityId,
        workspaceId: resolvedWorkspaceId,
        current: true,
      })
    )
  }

  return contexts
}
