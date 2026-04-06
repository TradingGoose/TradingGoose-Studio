import { normalizeOptionalString } from '@/lib/utils'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import type { ChatContext } from '@/stores/copilot/types'

type BuildImplicitCopilotContextsOptions = {
  workspaceId?: string | null
  pairContext?: PairColorContext | null
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

  if (resolvedWorkflowId) {
    contexts.push({
      kind: 'current_workflow',
      workflowId: resolvedWorkflowId,
      label: 'Current Workflow',
    })
  }

  const pushWorkspaceEntityContext = <
    TKind extends
      | 'current_indicator'
      | 'current_skill'
      | 'current_custom_tool'
      | 'current_mcp_server',
  >(
    kind: TKind,
    field:
      | 'indicatorId'
      | 'skillId'
      | 'customToolId'
      | 'mcpServerId',
    rawId: string | null | undefined,
    label: string
  ) => {
    const entityId = normalizeOptionalString(rawId)
    if (!entityId) {
      return
    }

    contexts.push({
      kind,
      label,
      ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
      [field]: entityId,
    } as ChatContext)
  }

  pushWorkspaceEntityContext(
    'current_indicator',
    'indicatorId',
    pairContext?.indicatorId,
    'Current Indicator'
  )
  pushWorkspaceEntityContext('current_skill', 'skillId', pairContext?.skillId, 'Current Skill')
  pushWorkspaceEntityContext(
    'current_custom_tool',
    'customToolId',
    pairContext?.customToolId,
    'Current Tool'
  )
  pushWorkspaceEntityContext(
    'current_mcp_server',
    'mcpServerId',
    pairContext?.mcpServerId,
    'Current MCP Server'
  )

  return contexts
}
