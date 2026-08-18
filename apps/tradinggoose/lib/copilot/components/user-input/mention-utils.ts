'use client'

import {
  buildCopilotContextIdentityKey,
  buildCopilotContextMentionRanges,
} from '@/lib/copilot/chat-contexts'
import type { MonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import type { ChatContext } from '@/stores/copilot/types'
import {
  COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS,
  isCopilotWorkspaceEntityMentionOption,
} from '../../workspace-entities'
import { MENTION_OPTIONS } from './constants'
import {
  type CopilotMentionCopy,
  getLogMentionSearchText,
  getMentionOptionLabel,
  getPastChatMentionLabel,
  getWorkspaceEntityMentionLabel,
} from './mention-copy'
import type {
  AggregatedMentionItem,
  BlockItem,
  LogItem,
  MentionItem,
  MentionOption,
  MentionRange,
  MentionSources,
  MentionSubmenu,
  PastChatItem,
  WorkspaceEntityItem,
} from './types'

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const includesNormalized = (value: string, query: string) =>
  normalize(value).includes(normalize(query))

const readMentionContextIdentityKey = (context: ChatContext): string | null => {
  try {
    return buildCopilotContextIdentityKey(context)
  } catch {
    return null
  }
}

export function buildMentionRanges(text: string, contexts: ChatContext[]): MentionRange[] {
  const validContexts = contexts.filter(
    (context) => readMentionContextIdentityKey(context) !== null
  )
  return buildCopilotContextMentionRanges(text, validContexts).map(
    ({ start, end, label, contextKey }) => ({ start, end, label, contextKey })
  )
}

export function retainMentionContextsInText(
  text: string,
  contexts: ChatContext[],
  rangeToExclude?: MentionRange
): ChatContext[] {
  const presentKeys = new Set(
    buildMentionRanges(text, contexts)
      .filter(
        (range) =>
          !rangeToExclude ||
          range.start !== rangeToExclude.start ||
          range.end !== rangeToExclude.end ||
          range.contextKey !== rangeToExclude.contextKey
      )
      .map((range) => range.contextKey)
  )
  return contexts.filter((context) => {
    const contextKey = readMentionContextIdentityKey(context)
    return contextKey !== null && presentKeys.has(contextKey)
  })
}

export function upsertMentionContextByTextOrder(
  contexts: ChatContext[],
  nextContext: ChatContext,
  text: string,
  mentionStart: number
): ChatContext[] {
  const nextContextKey = readMentionContextIdentityKey(nextContext)
  if (nextContextKey === null) return contexts

  const existingIndex = contexts.findIndex(
    (context) => readMentionContextIdentityKey(context) === nextContextKey
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
      [getWorkspaceEntityMentionLabel(copy, item), item.description || ''].join(' '),
      query
    )
  )
}

export function filterBlocks(items: BlockItem[], query: string) {
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

  if (submenu === 'blocks') {
    return filterBlocks(sources.blocksList, query)
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
    ...COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS.flatMap((entityKind) =>
      filterWorkspaceEntities(sources.workspaceEntities[entityKind], query, mentionCopy).map(
        (value) => ({
          type: entityKind,
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
