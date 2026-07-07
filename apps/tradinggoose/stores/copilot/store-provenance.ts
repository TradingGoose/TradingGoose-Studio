'use client'

import { DASHBOARD_LAYOUT_TOOL_NAMES } from '@/lib/copilot/registry'
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
  ownerUserId?: string
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
  if (
    context.contextEntityKind &&
    context.contextEntityKind !== 'dashboard_layout' &&
    context.contextEntityId &&
    !provenance.contextEntityId
  ) {
    provenance.contextEntityKind = context.contextEntityKind
    provenance.contextEntityId = context.contextEntityId
  }

  return Boolean(context.workspaceId || context.contextEntityId)
}

function readDashboardLayoutContext(
  context: ContextTurnProvenance
): CopilotToolExecutionProvenance['dashboardLayoutContext'] | null {
  if (context.contextEntityKind !== 'dashboard_layout') return null
  if (!context.contextEntityId || !context.workspaceId || !context.ownerUserId) return null

  return {
    entityId: context.contextEntityId,
    workspaceId: context.workspaceId,
    ownerUserId: context.ownerUserId,
  }
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
    ownerUserId: normalizeOptionalString(entityContext.ownerUserId),
    explicit: !entityContext.current,
  }
}

export function buildTurnProvenanceFromContexts(
  contexts: ChatContext[] | undefined,
  workspaceId: string | null | undefined,
  liveWorkflowId: string | null | undefined,
  reviewTarget: CopilotLiveContext['reviewTarget'],
  _authenticatedUserId?: string | null
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
      const dashboardLayoutContext = readDashboardLayoutContext(entityContext)
      if (dashboardLayoutContext && !provenance.dashboardLayoutContext) {
        provenance.dashboardLayoutContext = dashboardLayoutContext
      }
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
  if (!toolCall.provenance && !baseProvenance) {
    return toolCall
  }

  const dashboardLayoutContext =
    toolCall.provenance?.dashboardLayoutContext ?? baseProvenance?.dashboardLayoutContext
  const { dashboardLayoutContext: _baseDashboardLayoutContext, ...baseProvenanceRest } =
    baseProvenance ?? {}
  const { dashboardLayoutContext: _toolDashboardLayoutContext, ...toolProvenanceRest } =
    toolCall.provenance ?? {}
  let mergedProvenance = {
    ...baseProvenanceRest,
    ...toolProvenanceRest,
  }

  if (mergedProvenance.contextEntityKind !== 'dashboard_layout') {
    const { ownerUserId: _ownerUserId, ...withoutOwnerScope } = mergedProvenance
    mergedProvenance = withoutOwnerScope
  }

  if (dashboardLayoutContext && DASHBOARD_LAYOUT_TOOL_NAMES.has(toolCall.name)) {
    mergedProvenance.contextEntityKind = 'dashboard_layout'
    mergedProvenance.contextEntityId = dashboardLayoutContext.entityId
    mergedProvenance.workspaceId = dashboardLayoutContext.workspaceId
    mergedProvenance.ownerUserId = dashboardLayoutContext.ownerUserId
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
