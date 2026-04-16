import { normalizeOptionalString } from '@/lib/utils'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import type { ChatContext } from '@/stores/copilot/types'
import {
  REVIEW_ENTITY_KINDS,
  type ReviewEntityKind,
} from '@/lib/copilot/review-sessions/types'

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
  const reviewSessionId = normalizeOptionalString(pairContext?.reviewTarget?.reviewSessionId) ?? null
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

export function resolveCopilotWorkflowId(pairContext?: PairColorContext | null): string | undefined {
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
    contexts.push({
      kind: 'current_workflow',
      workflowId: resolvedWorkflowId,
      label: 'Current Workflow',
    })
  }

  const currentEntityContextBase = {
    ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
  }

  const skillId = normalizeOptionalString(pairContext?.skillId)
  if (skillId) {
    contexts.push({
      kind: 'current_skill',
      label: 'Current Skill',
      ...currentEntityContextBase,
      skillId,
    })
  }

  const customToolId = normalizeOptionalString(pairContext?.customToolId)
  if (customToolId) {
    contexts.push({
      kind: 'current_custom_tool',
      label: 'Current Tool',
      ...currentEntityContextBase,
      customToolId,
    })
  }

  const indicatorId = normalizeOptionalString(pairContext?.indicatorId)
  if (indicatorId) {
    contexts.push({
      kind: 'current_indicator',
      label: 'Current Indicator',
      ...currentEntityContextBase,
      indicatorId,
    })
  }

  const mcpServerId = normalizeOptionalString(pairContext?.mcpServerId)
  if (mcpServerId) {
    contexts.push({
      kind: 'current_mcp_server',
      label: 'Current MCP Server',
      ...currentEntityContextBase,
      mcpServerId,
    })
  }

  return contexts
}
