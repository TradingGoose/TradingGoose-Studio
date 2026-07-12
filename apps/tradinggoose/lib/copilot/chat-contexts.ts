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

export type CopilotContextMentionRange = {
  start: number
  end: number
  label: string
  contextKey: string
  context: ChatContext
}

export const isCopilotMentionBoundary = (char: string | undefined): boolean =>
  !char || /\s/u.test(char) || (/[\p{P}\p{S}]/u.test(char) && !/[-_@]/u.test(char))

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

export function buildCopilotContextMentionRanges(
  text: string,
  contexts: ChatContext[] | null | undefined
): CopilotContextMentionRange[] {
  if (!text) return []

  const contextsByLabel = new Map<string, { firstContextIndex: number; contexts: ChatContext[] }>()

  for (const [contextIndex, context] of extractExplicitCopilotContexts(contexts).entries()) {
    const label = context.label?.trim()
    if (!label) continue

    const group = contextsByLabel.get(label)
    if (group) {
      group.contexts.push(context)
    } else {
      contextsByLabel.set(label, { firstContextIndex: contextIndex, contexts: [context] })
    }
  }

  const ranges: CopilotContextMentionRange[] = []
  const labelGroups = [...contextsByLabel.entries()].sort(
    ([leftLabel, left], [rightLabel, right]) =>
      rightLabel.length - leftLabel.length || left.firstContextIndex - right.firstContextIndex
  )

  for (const [label, group] of labelGroups) {
    const token = `@${label}`
    let fromIndex = 0
    let contextIndex = 0

    while (fromIndex <= text.length) {
      const start = text.indexOf(token, fromIndex)
      if (start === -1) break

      const end = start + token.length
      const hasBoundary =
        isCopilotMentionBoundary(text[start - 1]) && isCopilotMentionBoundary(text[end])
      const overlapsLongerToken = ranges.some((range) => start < range.end && end > range.start)

      if (hasBoundary && !overlapsLongerToken) {
        const context = group.contexts[Math.min(contextIndex, group.contexts.length - 1)]
        ranges.push({
          start,
          end,
          label,
          contextKey: buildCopilotContextIdentityKey(context),
          context,
        })
        contextIndex = Math.min(contextIndex + 1, group.contexts.length - 1)
      }

      fromIndex = end
    }
  }

  return ranges.sort((left, right) => left.start - right.start)
}

const MODEL_MESSAGE_WITH_ONLY_ENTITY_CONTEXT = 'Use the attached workspace entity context.'

export function stripCopilotWorkspaceEntityMentions(
  message: string,
  contexts: ChatContext[] | null | undefined
): string {
  const ranges = buildCopilotContextMentionRanges(message, contexts).filter((range) =>
    Boolean(readCopilotWorkspaceEntityContext(range.context))
  )
  if (ranges.length === 0) return message

  const stripped = [...ranges]
    .reverse()
    .reduce((text, range) => `${text.slice(0, range.start)}${text.slice(range.end)}`, message)

  return stripped.trim() ? stripped : MODEL_MESSAGE_WITH_ONLY_ENTITY_CONTEXT
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
