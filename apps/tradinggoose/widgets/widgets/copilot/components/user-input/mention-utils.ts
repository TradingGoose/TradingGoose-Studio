'use client'

import {
  buildCopilotContextIdentityKey,
  buildCopilotContextMentionRanges,
  isCopilotMentionBoundary,
} from '@/lib/copilot/chat-contexts'
import type { MonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import type { ChatContext } from '@/stores/copilot/types'
import {
  COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS,
  isCopilotWorkspaceEntityMentionOption,
} from '../../workspace-entities'
import { MENTION_OPTIONS } from './constants'
import {
  type CopilotMentionCopy,
  getKnowledgeBaseMentionLabel,
  getLogMentionSearchText,
  getMentionOptionLabel,
  getPastChatMentionLabel,
  getWorkspaceEntityMentionLabel,
} from './mention-copy'
import type {
  AggregatedMentionItem,
  BlockItem,
  KnowledgeBaseItem,
  LogItem,
  MentionItem,
  MentionOption,
  MentionRange,
  MentionSources,
  MentionSubmenu,
  PastChatItem,
  WorkflowBlockItem,
  WorkspaceEntityItem,
} from './types'

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const includesNormalized = (value: string, query: string) =>
  normalize(value).includes(normalize(query))

export const isMentionBoundary = isCopilotMentionBoundary

export function buildMentionRanges(text: string, contexts: ChatContext[]): MentionRange[] {
  return buildCopilotContextMentionRanges(text, contexts).map(
    ({ start, end, label, contextKey }) => ({ start, end, label, contextKey })
  )
}

export function upsertMentionContextByTextOrder(
  contexts: ChatContext[],
  nextContext: ChatContext,
  text: string,
  mentionStart: number
): ChatContext[] {
  const nextContextKey = buildCopilotContextIdentityKey(nextContext)
  const existingIndex = contexts.findIndex(
    (context) => buildCopilotContextIdentityKey(context) === nextContextKey
  )

  if (existingIndex !== -1) {
    return contexts.map((context, index) => (index === existingIndex ? nextContext : context))
  }

  const insertIndex = buildMentionRanges(text, contexts).filter(
    (range) => range.start < mentionStart
  ).length

  return [...contexts.slice(0, insertIndex), nextContext, ...contexts.slice(insertIndex)]
}

export function filterMentionOptions(query: string, copy: CopilotMentionCopy): MentionOption[] {
  return MENTION_OPTIONS.filter((option) =>
    includesNormalized(getMentionOptionLabel(copy, option), query)
  )
}

export function filterPastChats(items: PastChatItem[], query: string, copy: CopilotMentionCopy) {
  return items.filter((item) => includesNormalized(getPastChatMentionLabel(copy, item), query))
}

export function filterWorkspaceEntities(
  items: WorkspaceEntityItem[],
  query: string,
  copy: CopilotMentionCopy
) {
  return items.filter((item) =>
    includesNormalized(
      [
        getWorkspaceEntityMentionLabel(copy, item),
        item.description || '',
        item.transport || '',
      ].join(' '),
      query
    )
  )
}

export function filterKnowledgeBases(items: KnowledgeBaseItem[], query: string) {
  return items.filter((item) => includesNormalized(getKnowledgeBaseMentionLabel(item), query))
}

export function filterBlocks(items: BlockItem[], query: string) {
  return items.filter((item) => includesNormalized(item.name || item.id, query))
}

export function filterWorkflowBlocks(items: WorkflowBlockItem[], query: string) {
  return items.filter((item) => includesNormalized(item.name || item.id, query))
}

export function filterLogs(items: LogItem[], query: string, monitorCopy: MonitorCopy) {
  return items.filter((item) =>
    includesNormalized(getLogMentionSearchText(monitorCopy, item), query)
  )
}

export function filterMentionItems(
  submenu: MentionSubmenu,
  sources: MentionSources,
  query: string,
  monitorCopy: MonitorCopy,
  mentionCopy: CopilotMentionCopy
): MentionItem[] {
  if (submenu === 'chats') {
    return filterPastChats(sources.pastChats, query, mentionCopy)
  }

  if (isCopilotWorkspaceEntityMentionOption(submenu)) {
    return filterWorkspaceEntities(sources.workspaceEntities[submenu], query, mentionCopy)
  }

  if (submenu === 'knowledge') {
    return filterKnowledgeBases(sources.knowledgeBases, query)
  }

  if (submenu === 'blocks') {
    return filterBlocks(sources.blocksList, query)
  }

  if (submenu === 'workflow_blocks') {
    return filterWorkflowBlocks(sources.workflowBlocks, query)
  }

  return filterLogs(sources.logsList, query, monitorCopy)
}

export function buildAggregatedMentionItems(
  query: string,
  sources: MentionSources,
  monitorCopy: MonitorCopy,
  mentionCopy: CopilotMentionCopy
): AggregatedMentionItem[] {
  const normalizedQuery = normalize(query)

  if (!normalizedQuery) {
    return []
  }

  return [
    ...filterWorkflowBlocks(sources.workflowBlocks, query).map((value) => ({
      type: 'workflow_blocks' as const,
      id: value.id,
      value,
    })),
    ...COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS.flatMap((config) =>
      filterWorkspaceEntities(sources.workspaceEntities[config.entityKind], query, mentionCopy).map(
        (value) => ({
          type: config.entityKind,
          id: value.id,
          value,
        })
      )
    ),
    ...filterBlocks(sources.blocksList, query).map((value) => ({
      type: 'blocks' as const,
      id: value.id,
      value,
    })),
    ...filterKnowledgeBases(sources.knowledgeBases, query).map((value) => ({
      type: 'knowledge' as const,
      id: value.id,
      value,
    })),
    ...filterPastChats(sources.pastChats, query, mentionCopy).map((value) => ({
      type: 'chats' as const,
      id: value.reviewSessionId,
      value,
    })),
    ...filterLogs(sources.logsList, query, monitorCopy).map((value) => ({
      type: 'logs' as const,
      id: value.id,
      value,
    })),
  ]
}

export function getPreferredMentionMenuWidth(
  openSubmenuFor: MentionSubmenu | null,
  aggregatedActive: boolean,
  containerWidth: number
) {
  const preferredWidth =
    openSubmenuFor === 'blocks'
      ? 320
      : openSubmenuFor === 'logs' ||
          openSubmenuFor === 'custom_tool' ||
          openSubmenuFor === 'mcp_server' ||
          aggregatedActive
        ? 384
        : 224

  return Math.min(preferredWidth, containerWidth)
}
