import type { ChatContext } from '@/stores/copilot/types'
import {
  COPILOT_WORKSPACE_ENTITY_CONFIGS,
  readCopilotWorkspaceEntityContext,
} from '@/widgets/widgets/copilot/workspace-entities'

const HIDDEN_COPILOT_CONTEXT_KINDS = new Set<ChatContext['kind']>(
  COPILOT_WORKSPACE_ENTITY_CONFIGS.map(
    (config) => `current_${config.entityKind}` as ChatContext['kind']
  )
)

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

  const entityContext = readCopilotWorkspaceEntityContext(context)
  if (entityContext) {
    return `${entityContext.entityKind}:${entityContext.entityId ?? getContextReviewIdentity()}`
  }

  switch (context.kind) {
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

  return context.label
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
