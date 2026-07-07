import type { ChatContext } from '@/stores/copilot/types'
import { readCopilotWorkspaceEntityContext } from '@/widgets/widgets/copilot/workspace-entities'

const HIDDEN_COPILOT_CONTEXT_KINDS = new Set<ChatContext['kind']>([
  'current_workflow',
  'current_skill',
  'current_custom_tool',
  'current_indicator',
  'current_mcp_server',
  'current_watchlist',
  'current_dashboard_layout',
])

export const isHiddenCopilotContext = (
  context: Pick<ChatContext, 'kind'> | null | undefined
): boolean => Boolean(context && HIDDEN_COPILOT_CONTEXT_KINDS.has(context.kind))

const extractExplicitCopilotContexts = (
  contexts: ChatContext[] | null | undefined
): ChatContext[] =>
  Array.isArray(contexts) ? contexts.filter((context) => !isHiddenCopilotContext(context)) : []

export const buildCopilotContextIdentityKey = (context: ChatContext): string => {
  const getContextReviewIdentity = () =>
    ('reviewSessionId' in context ? context.reviewSessionId : undefined) ??
    ('draftSessionId' in context ? context.draftSessionId : undefined) ??
    context.label

  const entityContext = readCopilotWorkspaceEntityContext(context)
  if (entityContext) {
    if (entityContext.entityKind === 'dashboard_layout') {
      if (!entityContext.ownerUserId || !entityContext.entityId) {
        throw new Error('Dashboard layout context requires ownerUserId and dashboardLayoutId')
      }
      return `dashboard_layout:${entityContext.ownerUserId}:${entityContext.entityId}`
    }
    return `${entityContext.entityKind}:${entityContext.entityId ?? getContextReviewIdentity()}`
  }

  switch (context.kind) {
    case 'past_chat':
      return `past_chat:${context.reviewSessionId}`
    case 'workflow_block':
      return `workflow_block:${context.workflowId}:${context.blockId}`
    case 'blocks':
      return `blocks:${[...(context.blockTypes ?? [])].sort().join(',')}`
    case 'knowledge':
      return `knowledge:${context.knowledgeId ?? context.label}`
    case 'docs':
      return 'docs'
    case 'logs':
      return `logs:${context.executionId ?? context.label}`
  }

  return context.label
}

const dedupeCopilotContexts = (contexts: ChatContext[]): ChatContext[] => {
  const seen = new Set<string>()
  return contexts.filter((context) => {
    const key = buildCopilotContextIdentityKey(context)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export const mergeCopilotContexts = ({
  explicitContexts,
  implicitContexts,
}: {
  explicitContexts?: ChatContext[] | null
  implicitContexts?: ChatContext[] | null
}): ChatContext[] => {
  const explicit = dedupeCopilotContexts(extractExplicitCopilotContexts(explicitContexts))
  const explicitKeys = new Set(explicit.map(buildCopilotContextIdentityKey))
  const implicit = dedupeCopilotContexts(
    Array.isArray(implicitContexts)
      ? implicitContexts.filter(
          (context) => !explicitKeys.has(buildCopilotContextIdentityKey(context))
        )
      : []
  )

  return [...explicit, ...implicit]
}
