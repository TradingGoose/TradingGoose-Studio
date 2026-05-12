import {
  ENTITY_KIND_CUSTOM_TOOL,
  ENTITY_KIND_INDICATOR,
  ENTITY_KIND_MCP_SERVER,
  ENTITY_KIND_SKILL,
  type ReviewTargetDescriptor,
  type ReviewEntityKind,
} from '@/lib/copilot/review-sessions/types'
import { normalizeOptionalString } from '@/lib/utils'
import type { ChatContext, CopilotLiveReviewTarget } from '@/stores/copilot/types'
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

export type CopilotEditableReviewTargetRequest = {
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string | null
  reviewSessionId: string | null
  draftSessionId: string | null
}

export function resolveCopilotWorkflowId(
  pairContext?: PairColorContext | null
): string | undefined {
  return getCopilotWorkspaceEntityIdFromPairContext(pairContext, 'workflow') ?? undefined
}

export function buildCopilotEditableReviewTargetRequest({
  pairContext,
}: {
  pairContext?: PairColorContext | null
}): CopilotEditableReviewTargetRequest | null {
  const entityKind = normalizeOptionalString(pairContext?.reviewEntityKind)
  if (!isEditableReviewEntityKind(entityKind)) {
    return null
  }

  const entityId = normalizeOptionalString(pairContext?.reviewEntityId) ?? null
  const reviewSessionId = normalizeOptionalString(pairContext?.reviewSessionId) ?? null
  const draftSessionId = normalizeOptionalString(pairContext?.reviewDraftSessionId) ?? null

  if (!entityId && !reviewSessionId && !draftSessionId) {
    return null
  }

  return {
    entityKind,
    entityId,
    reviewSessionId,
    draftSessionId,
  }
}

export function buildCopilotLiveReviewTarget(
  descriptor?: ReviewTargetDescriptor | null
): CopilotLiveReviewTarget | null {
  if (!descriptor || descriptor.entityKind === 'workflow' || !descriptor.reviewSessionId) {
    return null
  }

  return {
    entityKind: descriptor.entityKind,
    entityId: descriptor.entityId,
    reviewSessionId: descriptor.reviewSessionId,
    draftSessionId: descriptor.draftSessionId,
  }
}

function isEditableReviewEntityKind(
  value: string | null | undefined
): value is Exclude<ReviewEntityKind, 'workflow'> {
  return (
    value === ENTITY_KIND_SKILL ||
    value === ENTITY_KIND_CUSTOM_TOOL ||
    value === ENTITY_KIND_INDICATOR ||
    value === ENTITY_KIND_MCP_SERVER
  )
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
