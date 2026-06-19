'use client'

import type { MonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import {
  COPILOT_WORKSPACE_ENTITY_CONFIGS,
  getCopilotWorkspaceEntityKindFromMentionOption,
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
  MentionOption,
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

const includesNormalized = (value: string, query: string) => normalize(value).includes(query)

export function filterMentionOptions(query: string, copy: CopilotMentionCopy): MentionOption[] {
  const normalizedQuery = normalize(query)
  return MENTION_OPTIONS.filter((option) =>
    includesNormalized(getMentionOptionLabel(copy, option), normalizedQuery)
  )
}

export function filterPastChats(items: PastChatItem[], query: string, copy: CopilotMentionCopy) {
  const normalizedQuery = normalize(query)
  return items.filter((item) =>
    includesNormalized(getPastChatMentionLabel(copy, item), normalizedQuery)
  )
}

export function filterWorkspaceEntities(
  items: WorkspaceEntityItem[],
  query: string,
  copy: CopilotMentionCopy
) {
  const normalizedQuery = normalize(query)
  return items.filter((item) =>
    includesNormalized(
      [
        getWorkspaceEntityMentionLabel(copy, item),
        item.description || '',
        item.functionName || '',
        item.transport || '',
      ].join(' '),
      normalizedQuery
    )
  )
}

export function filterKnowledgeBases(
  items: KnowledgeBaseItem[],
  query: string,
  copy: CopilotMentionCopy
) {
  const normalizedQuery = normalize(query)
  return items.filter((item) =>
    includesNormalized(getKnowledgeBaseMentionLabel(copy, item), normalizedQuery)
  )
}

export function filterBlocks(items: BlockItem[], query: string) {
  const normalizedQuery = normalize(query)
  return items.filter((item) => includesNormalized(item.name || item.id, normalizedQuery))
}

export function filterWorkflowBlocks(items: WorkflowBlockItem[], query: string) {
  const normalizedQuery = normalize(query)
  return items.filter((item) => includesNormalized(item.name || item.id, normalizedQuery))
}

export function filterWorkspaceEntitiesForOption(
  option: MentionSubmenu,
  sources: MentionSources,
  query: string,
  copy: CopilotMentionCopy
) {
  if (!isCopilotWorkspaceEntityMentionOption(option)) {
    return []
  }

  const entityKind = getCopilotWorkspaceEntityKindFromMentionOption(option)
  return filterWorkspaceEntities(sources.workspaceEntities[entityKind], query, copy)
}

export function filterLogs(items: LogItem[], query: string, monitorCopy: MonitorCopy) {
  const normalizedQuery = normalize(query)
  return items.filter((item) =>
    includesNormalized(getLogMentionSearchText(monitorCopy, item), normalizedQuery)
  )
}

export function buildAggregatedMentionItems(
  query: string,
  sources: MentionSources,
  copy: CopilotMentionCopy,
  monitorCopy: MonitorCopy
): AggregatedMentionItem[] {
  const normalizedQuery = normalize(query)

  if (!normalizedQuery) {
    return []
  }

  return [
    ...filterWorkflowBlocks(sources.workflowBlocks, normalizedQuery).map((value) => ({
      type: 'workflow_blocks' as const,
      id: value.id,
      value,
    })),
    ...COPILOT_WORKSPACE_ENTITY_CONFIGS.flatMap((config) =>
      filterWorkspaceEntities(
        sources.workspaceEntities[config.entityKind],
        normalizedQuery,
        copy
      ).map((value) => ({
        type: config.entityKind,
        id: value.id,
        value,
      }))
    ),
    ...filterBlocks(sources.blocksList, normalizedQuery).map((value) => ({
      type: 'blocks' as const,
      id: value.id,
      value,
    })),
    ...filterKnowledgeBases(sources.knowledgeBases, normalizedQuery, copy).map((value) => ({
      type: 'knowledge' as const,
      id: value.id,
      value,
    })),
    ...filterPastChats(sources.pastChats, normalizedQuery, copy).map((value) => ({
      type: 'chats' as const,
      id: value.reviewSessionId,
      value,
    })),
    ...filterLogs(sources.logsList, normalizedQuery, monitorCopy).map((value) => ({
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
