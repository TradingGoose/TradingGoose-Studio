import { normalizeOptionalString } from '@/lib/utils'
import type { ChatContext } from '@/stores/copilot/types'
import { normalizePairColorContext, type PairColorContext } from '@/widgets/color-pairs'
import {
  buildCopilotWorkspaceEntityContext,
  COPILOT_PAIR_CONTEXT_ENTITY_CONFIGS,
  type CopilotWorkspaceEntityKind,
  getCopilotWorkspaceEntityIdFromPairContext,
} from './workspace-entities'

type BuildImplicitCopilotContextsOptions = {
  workspaceId?: string | null
  pairContext?: PairColorContext | null
  currentLayoutId?: string | null
  currentLayoutOwnerUserId?: string | null
  currentLabels: Partial<Record<CopilotWorkspaceEntityKind, string>>
}

export function resolveCopilotWorkflowId(
  pairContext?: PairColorContext | null
): string | undefined {
  return getCopilotWorkspaceEntityIdFromPairContext(pairContext, 'workflow') ?? undefined
}

export const buildImplicitCopilotContexts = ({
  workspaceId,
  pairContext,
  currentLayoutId,
  currentLayoutOwnerUserId,
  currentLabels,
}: BuildImplicitCopilotContextsOptions): ChatContext[] => {
  // These contexts describe what the user is looking at right now. They are sent
  // with each turn, but they do not mount or select editable review sessions.
  const resolvedWorkspaceId = normalizeOptionalString(workspaceId)
  const currentPairContext = normalizePairColorContext(pairContext)
  const contexts: ChatContext[] = []

  for (const config of COPILOT_PAIR_CONTEXT_ENTITY_CONFIGS) {
    const entityId = getCopilotWorkspaceEntityIdFromPairContext(
      currentPairContext,
      config.entityKind
    )
    if (!entityId) {
      continue
    }

    contexts.push(
      buildCopilotWorkspaceEntityContext({
        entityKind: config.entityKind,
        entityId,
        workspaceId: resolvedWorkspaceId,
        label: currentLabels[config.entityKind] ?? `Current ${config.entityKind}`,
        current: true,
      })
    )
  }

  const layoutId = normalizeOptionalString(currentLayoutId)
  const layoutOwnerUserId = normalizeOptionalString(currentLayoutOwnerUserId)
  if (layoutId && layoutOwnerUserId && resolvedWorkspaceId) {
    contexts.push(
      buildCopilotWorkspaceEntityContext({
        entityKind: 'dashboard_layout',
        entityId: layoutId,
        workspaceId: resolvedWorkspaceId,
        ownerUserId: layoutOwnerUserId,
        label: currentLabels.dashboard_layout ?? 'Current dashboard layout',
        current: true,
      })
    )
  }

  return contexts
}
