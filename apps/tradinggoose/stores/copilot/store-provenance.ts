'use client'

import { REVIEW_ENTITY_KINDS, type ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { normalizeOptionalString } from '@/lib/utils'
import type {
  ChatContext,
  CopilotLiveReviewTarget,
  CopilotMessage,
  CopilotToolCall,
  CopilotToolExecutionProvenance,
} from '@/stores/copilot/types'

type ContextTurnProvenance = {
  workspaceId?: string
  contextWorkflowId?: string
  explicit: boolean
}

function isReviewEntityKind(entityKind: string | null | undefined): entityKind is ReviewEntityKind {
  return REVIEW_ENTITY_KINDS.includes(entityKind as ReviewEntityKind)
}

function applyContextTurnProvenance(
  provenance: CopilotToolExecutionProvenance,
  context: ContextTurnProvenance
): boolean {
  const { explicit } = context
  if (context.workspaceId && (explicit || !provenance.workspaceId)) {
    provenance.workspaceId = context.workspaceId
  }
  if (context.contextWorkflowId && !provenance.contextWorkflowId) {
    provenance.contextWorkflowId = context.contextWorkflowId
  }

  return Boolean(context.workspaceId || context.contextWorkflowId)
}

function getContextTurnProvenance(context: ChatContext): ContextTurnProvenance | null {
  if (context.kind === 'current_workflow') {
    return {
      contextWorkflowId: normalizeOptionalString(context.workflowId),
      explicit: false,
    }
  }

  const rawKind = context.kind.startsWith('current_')
    ? context.kind.slice('current_'.length)
    : context.kind
  if (!isReviewEntityKind(rawKind)) return null

  const current = context.kind.startsWith('current_')
  const typedContext = context as any
  return {
    workspaceId: normalizeOptionalString(typedContext.workspaceId),
    explicit: !current,
  }
}

function applyLiveReviewTargetProvenance(
  provenance: CopilotToolExecutionProvenance,
  reviewTarget: CopilotLiveReviewTarget | null | undefined
): boolean {
  const entityKind = reviewTarget?.entityKind
  const reviewSessionId = normalizeOptionalString(reviewTarget?.reviewSessionId)
  const draftSessionId = normalizeOptionalString(reviewTarget?.draftSessionId)

  if (!entityKind || !reviewSessionId) {
    return false
  }

  provenance.entityKind = entityKind
  provenance.reviewSessionId = reviewSessionId

  if (draftSessionId) {
    provenance.draftSessionId = draftSessionId
  }

  return true
}

export function buildTurnProvenanceFromContexts(
  contexts: ChatContext[] | undefined,
  workspaceId?: string | null,
  reviewTarget?: CopilotLiveReviewTarget | null,
  contextWorkflowId?: string | null
): CopilotToolExecutionProvenance | undefined {
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId)
  const normalizedContextWorkflowId = normalizeOptionalString(contextWorkflowId)
  const provenance: CopilotToolExecutionProvenance = {
    ...(normalizedContextWorkflowId ? { contextWorkflowId: normalizedContextWorkflowId } : {}),
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
  }
  let hasContext = !!normalizedWorkspaceId || !!normalizedContextWorkflowId

  for (const context of contexts ?? []) {
    const entityContext = getContextTurnProvenance(context)
    if (entityContext) {
      hasContext = applyContextTurnProvenance(provenance, entityContext) || hasContext
    }
  }

  hasContext = applyLiveReviewTargetProvenance(provenance, reviewTarget) || hasContext

  return hasContext ? provenance : undefined
}

export function withPinnedToolExecutionProvenance(
  toolCall: CopilotToolCall,
  baseProvenance?: CopilotToolExecutionProvenance
): CopilotToolCall {
  const explicitWorkflowId =
    typeof toolCall.params?.workflowId === 'string' && toolCall.params.workflowId.trim()
      ? toolCall.params.workflowId.trim()
      : undefined
  const explicitEntityId = normalizeOptionalString(toolCall.params?.entityId)

  const mergedProvenance = {
    ...(baseProvenance ?? {}),
    ...(toolCall.provenance ?? {}),
    ...(explicitWorkflowId ? { workflowId: explicitWorkflowId } : {}),
    ...(explicitEntityId ? { entityId: explicitEntityId } : {}),
  }

  if (!toolCall.provenance && !baseProvenance && !explicitWorkflowId && !explicitEntityId) {
    return toolCall
  }

  return {
    ...toolCall,
    provenance: mergedProvenance,
  }
}

export function findAssistantMessageIdForToolCall(
  messages: CopilotMessage[],
  toolCallId: string
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue

    if (Array.isArray(message.toolCalls) && message.toolCalls.some((toolCall) => toolCall.id === toolCallId)) {
      return message.id
    }

    if (
      Array.isArray(message.contentBlocks) &&
      message.contentBlocks.some(
        (block) => block.type === 'tool_call' && block.toolCall?.id === toolCallId
      )
    ) {
      return message.id
    }
  }

  return null
}
