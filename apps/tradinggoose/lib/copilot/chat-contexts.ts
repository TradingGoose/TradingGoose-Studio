import type { ChatContext } from '@/stores/copilot/types'

const HIDDEN_COPILOT_CONTEXT_KINDS = new Set<ChatContext['kind']>([
  'current_workflow',
  'current_skill',
  'current_indicator',
  'current_custom_tool',
  'current_mcp_server',
])

export const isHiddenCopilotContext = (
  context: Pick<ChatContext, 'kind'> | null | undefined
): boolean => Boolean(context && HIDDEN_COPILOT_CONTEXT_KINDS.has(context.kind))

export const extractExplicitCopilotContexts = (
  contexts: ChatContext[] | null | undefined
): ChatContext[] =>
  Array.isArray(contexts) ? contexts.filter((context) => !isHiddenCopilotContext(context)) : []

const buildContextIdentityKey = (context: ChatContext): string => {
  const getContextReviewIdentity = () =>
    ('reviewSessionId' in context ? context.reviewSessionId : undefined) ??
    ('draftSessionId' in context ? context.draftSessionId : undefined) ??
    context.label

  switch (context.kind) {
    case 'workflow':
    case 'current_workflow':
      return `workflow:${context.workflowId}`
    case 'skill':
    case 'current_skill':
      return `skill:${context.skillId ?? getContextReviewIdentity()}`
    case 'indicator':
    case 'current_indicator':
      return `indicator:${context.indicatorId ?? getContextReviewIdentity()}`
    case 'custom_tool':
    case 'current_custom_tool':
      return `custom_tool:${context.customToolId ?? getContextReviewIdentity()}`
    case 'mcp_server':
    case 'current_mcp_server':
      return `mcp_server:${context.mcpServerId ?? getContextReviewIdentity()}`
    case 'past_chat':
      return `past_chat:${context.reviewSessionId}`
    case 'workflow_block':
      return `workflow_block:${context.workflowId}:${context.blockId}`
    case 'blocks':
      return `blocks:${[...context.blockIds].sort().join(',')}`
    case 'knowledge':
      return `knowledge:${context.knowledgeId ?? context.label}`
    case 'templates':
      return `templates:${context.templateId ?? context.label}`
    case 'docs':
      return `docs:${context.label}`
    case 'logs':
      return `logs:${context.executionId ?? context.label}`
  }
}

const dedupeCopilotContexts = (contexts: ChatContext[]): ChatContext[] => {
  const seen = new Set<string>()
  return contexts.filter((context) => {
    const key = buildContextIdentityKey(context)
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
  const explicitKeys = new Set(explicit.map(buildContextIdentityKey))
  const implicit = dedupeCopilotContexts(
    Array.isArray(implicitContexts)
      ? implicitContexts.filter((context) => !explicitKeys.has(buildContextIdentityKey(context)))
      : []
  )

  return [...explicit, ...implicit]
}

export const areCopilotContextsEqual = (
  left: ChatContext[] | null | undefined,
  right: ChatContext[] | null | undefined
): boolean => {
  const leftContexts = Array.isArray(left) ? left : []
  const rightContexts = Array.isArray(right) ? right : []

  if (leftContexts.length !== rightContexts.length) {
    return false
  }

  return leftContexts.every(
    (context, index) => JSON.stringify(context) === JSON.stringify(rightContexts[index])
  )
}
