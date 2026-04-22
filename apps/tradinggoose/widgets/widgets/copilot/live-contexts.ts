import { REVIEW_ENTITY_KINDS, type ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
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

export type CopilotEditableReviewTarget = {
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string | null
  reviewSessionId?: string | null
  draftSessionId: string | null
}

type ActiveReviewTarget = {
  entityKind: ReviewEntityKind
  entityId: string | null
  reviewSessionId: string | null
  draftSessionId: string | null
}

function readPairReviewTarget(pairContext?: PairColorContext | null): ActiveReviewTarget | null {
  const reviewEntityKind = normalizeOptionalString(pairContext?.reviewTarget?.reviewEntityKind)
  const reviewEntityId = normalizeOptionalString(pairContext?.reviewTarget?.reviewEntityId) ?? null
  const reviewSessionId =
    normalizeOptionalString(pairContext?.reviewTarget?.reviewSessionId) ?? null
  const draftSessionId =
    normalizeOptionalString(pairContext?.reviewTarget?.reviewDraftSessionId) ?? null

  if (
    !reviewEntityKind ||
    !REVIEW_ENTITY_KINDS.includes(reviewEntityKind as ReviewEntityKind) ||
    (!reviewEntityId && !reviewSessionId && !draftSessionId)
  ) {
    return null
  }

  return {
    entityKind: reviewEntityKind as ReviewEntityKind,
    entityId: reviewEntityId,
    reviewSessionId,
    draftSessionId,
  }
}

export function resolveCopilotWorkflowId(
  pairContext?: PairColorContext | null
): string | undefined {
  return normalizeOptionalString(pairContext?.workflowId)
}

export function buildCopilotEditableReviewTargets({
  pairContext,
}: Pick<BuildImplicitCopilotContextsOptions, 'pairContext'>): CopilotEditableReviewTarget[] {
  const activeReviewTarget = readPairReviewTarget(pairContext)

  if (!activeReviewTarget || activeReviewTarget.entityKind === 'workflow') {
    return []
  }

  return [
    {
      entityKind: activeReviewTarget.entityKind,
      entityId: activeReviewTarget.entityId,
      reviewSessionId: activeReviewTarget.reviewSessionId,
      draftSessionId: activeReviewTarget.draftSessionId,
    },
  ]
}

export const buildImplicitCopilotContexts = ({
  workspaceId,
  pairContext,
}: BuildImplicitCopilotContextsOptions): ChatContext[] => {
  // These contexts describe what the user is looking at right now. They are sent
  // with each turn, but they do not mount or select editable review sessions.
  const resolvedWorkflowId = resolveCopilotWorkflowId(pairContext)
  const resolvedWorkspaceId = normalizeOptionalString(workspaceId)
  const contexts: ChatContext[] = []

  if (resolvedWorkflowId) {
    contexts.push(
      buildCopilotWorkspaceEntityContext({
        entityKind: 'workflow',
        entityId: resolvedWorkflowId,
        current: true,
      })
    )
  }

  for (const config of COPILOT_WORKSPACE_ENTITY_CONFIGS) {
    if (config.entityKind === 'workflow') {
      continue
    }

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
