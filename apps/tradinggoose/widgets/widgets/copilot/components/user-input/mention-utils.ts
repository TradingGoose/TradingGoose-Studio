'use client'

import {
  COPILOT_WORKSPACE_ENTITY_CONFIGS,
  getCopilotWorkspaceEntityConfigForMentionOption,
  getCopilotWorkspaceEntityKindFromMentionOption,
  isCopilotWorkspaceEntityMentionOption,
} from '../../workspace-entities'
import { MENTION_OPTIONS } from './constants'
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

const normalize = (value: string) => value.toLowerCase()

export function filterMentionOptions(query: string): MentionOption[] {
  const normalizedQuery = normalize(query)
  return MENTION_OPTIONS.filter((option) => option.toLowerCase().includes(normalizedQuery))
}

export function filterPastChats(items: PastChatItem[], query: string) {
  const normalizedQuery = normalize(query)
  return items.filter((item) =>
    (item.title || 'Untitled Chat').toLowerCase().includes(normalizedQuery)
  )
}

export function filterWorkspaceEntities(items: WorkspaceEntityItem[], query: string) {
  const normalizedQuery = normalize(query)
  return items.filter((item) =>
    [item.name, item.description || '', item.functionName || '', item.transport || '']
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  )
}

export function filterKnowledgeBases(items: KnowledgeBaseItem[], query: string) {
  const normalizedQuery = normalize(query)
  return items.filter((item) => (item.name || 'Untitled').toLowerCase().includes(normalizedQuery))
}

export function filterBlocks(items: BlockItem[], query: string) {
  const normalizedQuery = normalize(query)
  return items.filter((item) => (item.name || item.id).toLowerCase().includes(normalizedQuery))
}

export function filterWorkflowBlocks(items: WorkflowBlockItem[], query: string) {
  const normalizedQuery = normalize(query)
  return items.filter((item) => (item.name || item.id).toLowerCase().includes(normalizedQuery))
}

export function filterWorkspaceEntitiesForOption(
  option: MentionSubmenu,
  sources: MentionSources,
  query: string
) {
  if (!isCopilotWorkspaceEntityMentionOption(option)) {
    return []
  }

  const entityKind = getCopilotWorkspaceEntityKindFromMentionOption(option)
  return filterWorkspaceEntities(sources.workspaceEntities[entityKind], query)
}

export function filterLogs(items: LogItem[], query: string) {
  const normalizedQuery = normalize(query)
  return items.filter((item) =>
    [item.workflowName, item.trigger || ''].join(' ').toLowerCase().includes(normalizedQuery)
  )
}

export function buildAggregatedMentionItems(
  query: string,
  sources: MentionSources
): AggregatedMentionItem[] {
  const normalizedQuery = normalize(query)

  if (!normalizedQuery) {
    return []
  }

  return [
    ...filterWorkflowBlocks(sources.workflowBlocks, normalizedQuery).map((value) => ({
      type: 'Workflow Blocks' as const,
      id: value.id,
      value,
    })),
    ...COPILOT_WORKSPACE_ENTITY_CONFIGS.flatMap((config) =>
      filterWorkspaceEntities(sources.workspaceEntities[config.entityKind], normalizedQuery).map(
        (value) => ({
          type: config.mentionOption,
          id: value.id,
          value,
        })
      )
    ),
    ...filterBlocks(sources.blocksList, normalizedQuery).map((value) => ({
      type: 'Blocks' as const,
      id: value.id,
      value,
    })),
    ...filterKnowledgeBases(sources.knowledgeBases, normalizedQuery).map((value) => ({
      type: 'Knowledge' as const,
      id: value.id,
      value,
    })),
    ...filterPastChats(sources.pastChats, normalizedQuery).map((value) => ({
      type: 'Chats' as const,
      id: value.reviewSessionId,
      value,
    })),
    ...filterLogs(sources.logsList, normalizedQuery).map((value) => ({
      type: 'Logs' as const,
      id: value.id,
      value,
    })),
  ]
}

export function getMentionSubmenuTitle(submenu: MentionSubmenu) {
  if (isCopilotWorkspaceEntityMentionOption(submenu)) {
    return getCopilotWorkspaceEntityConfigForMentionOption(submenu).submenuTitle
  }

  if (submenu === 'Knowledge') {
    return 'Knowledge Bases'
  }

  return submenu
}

export function getPreferredMentionMenuWidth(
  openSubmenuFor: MentionSubmenu | null,
  aggregatedActive: boolean,
  containerWidth: number
) {
  const preferredWidth =
    openSubmenuFor === 'Blocks'
      ? 320
      : openSubmenuFor === 'Logs' ||
          openSubmenuFor === 'Custom Tools' ||
          openSubmenuFor === 'MCP Servers' ||
          aggregatedActive
        ? 384
        : 224

  return Math.min(preferredWidth, containerWidth)
}
