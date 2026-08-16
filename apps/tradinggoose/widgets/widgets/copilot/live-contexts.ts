import { normalizeOptionalString } from '@/lib/utils'
import type { ChatContext } from '@/stores/copilot/types'
import {
  buildCopilotWorkspaceEntityContext,
  COPILOT_EFFECTIVE_PARAM_ENTITY_CONFIGS,
  type CopilotWorkspaceEntityKind,
  getCopilotWorkspaceEntityIdFromEffectiveParams,
} from './workspace-entities'

type BuildImplicitCopilotContextsOptions = {
  workspaceId?: string | null
  effectiveParams?: Record<string, unknown> | null
  currentLayoutId?: string | null
  currentLayoutOwnerUserId?: string | null
  currentLabels: Partial<Record<CopilotWorkspaceEntityKind, string>>
}

export function resolveCopilotWorkflowId(
  effectiveParams?: Record<string, unknown> | null
): string | undefined {
  return getCopilotWorkspaceEntityIdFromEffectiveParams(effectiveParams, 'workflow') ?? undefined
}

export const buildImplicitCopilotContexts = ({
  workspaceId,
  effectiveParams,
  currentLayoutId,
  currentLayoutOwnerUserId,
  currentLabels,
}: BuildImplicitCopilotContextsOptions): ChatContext[] => {
  // These contexts describe what the user is looking at right now. They are sent
  // with each turn, but they do not mount or select editable review sessions.
  const resolvedWorkspaceId = normalizeOptionalString(workspaceId)
  const contexts: ChatContext[] = []

  for (const config of COPILOT_EFFECTIVE_PARAM_ENTITY_CONFIGS) {
    const entityId = getCopilotWorkspaceEntityIdFromEffectiveParams(
      effectiveParams,
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
