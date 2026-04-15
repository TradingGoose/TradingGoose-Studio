import { normalizeOptionalString } from '@/lib/utils'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import type { ChatContext } from '@/stores/copilot/types'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'

type BuildImplicitCopilotContextsOptions = {
  workspaceId?: string | null
  pairContext?: PairColorContext | null
}

type ActiveCopilotEntityContext = {
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string | null
}

function resolveActiveCopilotEntityContexts(
  pairContext?: PairColorContext | null
): ActiveCopilotEntityContext[] {
  if (!pairContext) {
    return []
  }

  return [
    {
      entityKind: 'skill' as const,
      entityId: normalizeOptionalString(pairContext.skillId) ?? null,
    },
    {
      entityKind: 'custom_tool' as const,
      entityId: normalizeOptionalString(pairContext.customToolId) ?? null,
    },
    {
      entityKind: 'indicator' as const,
      entityId: normalizeOptionalString(pairContext.indicatorId) ?? null,
    },
    {
      entityKind: 'mcp_server' as const,
      entityId: normalizeOptionalString(pairContext.mcpServerId) ?? null,
    },
  ].filter(
    (candidate): candidate is {
      entityKind: ActiveCopilotEntityContext['entityKind']
      entityId: string
    } => !!candidate.entityId
  )
}

export const buildImplicitCopilotContexts = ({
  workspaceId,
  pairContext,
}: BuildImplicitCopilotContextsOptions): ChatContext[] => {
  // These contexts describe what the user is looking at right now. They are sent
  // with each turn, but they do not control which generic copilot chat thread is reused.
  const resolvedWorkflowId = normalizeOptionalString(pairContext?.workflowId)
  const resolvedWorkspaceId = normalizeOptionalString(workspaceId)
  const contexts: ChatContext[] = []
  const activeEntities = resolveActiveCopilotEntityContexts(pairContext)

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

  for (const activeEntity of activeEntities) {
    switch (activeEntity.entityKind) {
      case 'indicator':
        contexts.push({
          kind: 'current_indicator',
          label: 'Current Indicator',
          ...currentEntityContextBase,
          indicatorId: activeEntity.entityId,
        })
        break
      case 'skill':
        contexts.push({
          kind: 'current_skill',
          label: 'Current Skill',
          ...currentEntityContextBase,
          skillId: activeEntity.entityId,
        })
        break
      case 'custom_tool':
        contexts.push({
          kind: 'current_custom_tool',
          label: 'Current Tool',
          ...currentEntityContextBase,
          customToolId: activeEntity.entityId,
        })
        break
      case 'mcp_server':
        contexts.push({
          kind: 'current_mcp_server',
          label: 'Current MCP Server',
          ...currentEntityContextBase,
          mcpServerId: activeEntity.entityId,
        })
        break
    }
  }

  return contexts
}
