'use client'

import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { normalizeOptionalString } from '@/lib/utils'
import type {
  ChatContext,
  CopilotLiveContext,
  CopilotMessage,
  CopilotToolCall,
  CopilotToolExecutionProvenance,
} from '@/stores/copilot/types'
import { readCopilotWorkspaceEntityContext } from '@/widgets/widgets/copilot/workspace-entities'

type ContextTurnProvenance = {
  workspaceId?: string
  contextEntityKind?: ReviewEntityKind
  contextEntityId?: string
  explicit: boolean
}

function applyContextTurnProvenance(
  provenance: CopilotToolExecutionProvenance,
  context: ContextTurnProvenance
): boolean {
  const { explicit } = context
  if (context.workspaceId && (explicit || !provenance.workspaceId)) {
    provenance.workspaceId = context.workspaceId
  }
  if (context.contextEntityKind && context.contextEntityId && !provenance.contextEntityId) {
    provenance.contextEntityKind = context.contextEntityKind
    provenance.contextEntityId = context.contextEntityId
  }

  return Boolean(context.workspaceId || context.contextEntityId)
}

function getContextTurnProvenance(context: ChatContext): ContextTurnProvenance | null {
  const entityContext = readCopilotWorkspaceEntityContext(context)
  if (!entityContext) {
    return null
  }

  return {
    workspaceId: normalizeOptionalString(entityContext.workspaceId),
    contextEntityKind: entityContext.entityKind,
    contextEntityId: normalizeOptionalString(entityContext.entityId),
    explicit: !entityContext.current,
  }
}

export function buildTurnProvenanceFromContexts(
  contexts: ChatContext[] | undefined,
  workspaceId: string | null | undefined,
  liveWorkflowId: string | null | undefined,
  reviewTarget: CopilotLiveContext['reviewTarget']
): CopilotToolExecutionProvenance | undefined {
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId)
  const normalizedLiveWorkflowId = normalizeOptionalString(liveWorkflowId)
  const provenance: CopilotToolExecutionProvenance = {
    ...(normalizedLiveWorkflowId
      ? {
          contextEntityKind: 'workflow' as const,
          contextEntityId: normalizedLiveWorkflowId,
        }
      : {}),
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
  }
  let hasContext = !!normalizedWorkspaceId || !!normalizedLiveWorkflowId

  for (const context of contexts ?? []) {
    const entityContext = getContextTurnProvenance(context)
    if (entityContext) {
      hasContext = applyContextTurnProvenance(provenance, entityContext) || hasContext
    }
  }

  if (reviewTarget && reviewTarget.entityKind !== 'workflow') {
    const reviewWorkspaceId = normalizeOptionalString(reviewTarget.workspaceId)
    if (!reviewWorkspaceId) {
      return hasContext ? provenance : undefined
    }

    provenance.workspaceId = reviewWorkspaceId
    hasContext = true
  }

  return hasContext ? provenance : undefined
}

export function withPinnedToolExecutionProvenance(
  toolCall: CopilotToolCall,
  baseProvenance?: CopilotToolExecutionProvenance
): CopilotToolCall {
  const mergedProvenance = {
    ...(baseProvenance ?? {}),
    ...(toolCall.provenance ?? {}),
  }

  if (!toolCall.provenance && !baseProvenance) {
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
