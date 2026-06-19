'use client'

import { type Messages, useMessages } from 'next-intl'
import {
  getMonitorTriggerLabel,
  type MonitorCopy,
} from '@/app/workspace/[workspaceId]/monitor/copy'
import type { CopilotWorkspaceEntityKind } from '../../workspace-entities'
import type {
  KnowledgeBaseItem,
  LogItem,
  MentionOption,
  MentionSubmenu,
  PastChatItem,
  WorkspaceEntityItem,
} from './types'

export type CopilotMentionCopy = ReturnType<typeof getCopilotMentionCopyFromMessages>

export function getCopilotMentionCopyFromMessages(messages: Messages) {
  const workspace = messages.workspace
  const widgets = workspace?.widgets
  const copilot = widgets?.copilot

  if (!workspace || !widgets || !copilot) {
    throw new Error('Missing workspace copilot messages required for mention copy.')
  }

  return {
    optionLabels: {
      chats: widgets.workflowLabels.chats,
      workflow: widgets.workflowLabels.workflows,
      skill: widgets.workflowLabels.skills,
      custom_tool: widgets.workflowLabels.customTools,
      indicator: widgets.workflowLabels.indicators,
      mcp_server: widgets.workflowLabels.mcpServers,
      workflow_blocks: copilot.mentions.workflowBlocks,
      blocks: widgets.workflowToolbar.blocks,
      knowledge: workspace.dashboard.pages.knowledge,
      docs: messages.nav.docs,
      logs: workspace.dashboard.pages.logs,
    } satisfies Record<MentionOption, string>,
    submenuTitles: {
      chats: widgets.workflowLabels.chats,
      workflow: widgets.workflowLabels.allWorkflows,
      skill: widgets.workflowLabels.skills,
      custom_tool: widgets.workflowLabels.customTools,
      indicator: widgets.workflowLabels.indicators,
      mcp_server: widgets.workflowLabels.mcpServers,
      workflow_blocks: copilot.mentions.workflowBlocks,
      blocks: widgets.workflowToolbar.blocks,
      knowledge: workspace.dashboard.sections.knowledgeBases,
      logs: workspace.dashboard.pages.logs,
    } satisfies Record<MentionSubmenu, string>,
    emptyStates: {
      chats: copilot.mentions.noPastChats,
      workflow: copilot.mentions.noWorkflows,
      skill: copilot.mentions.noSkills,
      indicator: copilot.mentions.noIndicators,
      custom_tool: copilot.mentions.noCustomTools,
      mcp_server: copilot.mentions.noMcpServers,
      knowledge: copilot.mentions.noKnowledgeBases,
      blocks: copilot.mentions.noBlocksFound,
      workflow_blocks: copilot.mentions.noBlocksInWorkflow,
      logs: copilot.mentions.noExecutionsFound,
    } satisfies Record<MentionSubmenu, string>,
    fallbackLabels: {
      untitledChat: copilot.mentions.untitledChat,
      untitledItem: copilot.mentions.untitled,
      workspaceEntities: {
        workflow: widgets.workflowDropdown.untitledWorkflow,
        skill: widgets.skillDropdown.untitledSkill,
        indicator: widgets.indicatorList.listItem.untitledIndicator,
        custom_tool: widgets.customToolDropdown.untitledCustomTool,
        mcp_server: widgets.mcpDropdown.unnamedServer,
      } satisfies Record<CopilotWorkspaceEntityKind, string>,
    },
    matches: copilot.mentions.matches,
    noMatches: copilot.mentions.noMatches,
    loading: copilot.history.loading,
  }
}

export function useCopilotMentionCopy(): CopilotMentionCopy {
  return getCopilotMentionCopyFromMessages(useMessages())
}

export function getMentionOptionLabel(copy: CopilotMentionCopy, option: MentionOption): string {
  return copy.optionLabels[option]
}

export function getMentionSubmenuTitle(copy: CopilotMentionCopy, submenu: MentionSubmenu): string {
  return copy.submenuTitles[submenu]
}

export function getWorkspaceEntityMentionEmptyState(
  copy: CopilotMentionCopy,
  entityKind: CopilotWorkspaceEntityKind
): string {
  return copy.emptyStates[entityKind]
}

export function getWorkspaceEntityMentionLabel(
  copy: CopilotMentionCopy,
  item: Pick<WorkspaceEntityItem, 'entityKind' | 'name'>
): string {
  const label = item.name.trim()
  return label || copy.fallbackLabels.workspaceEntities[item.entityKind]
}

export function getPastChatMentionLabel(
  copy: CopilotMentionCopy,
  item: Pick<PastChatItem, 'title'>
): string {
  const label = item.title?.trim()
  return label || copy.fallbackLabels.untitledChat
}

export function getKnowledgeBaseMentionLabel(
  copy: CopilotMentionCopy,
  item: Pick<KnowledgeBaseItem, 'name'>
): string {
  const label = item.name.trim()
  return label || copy.fallbackLabels.untitledItem
}

export function getLogMentionTriggerLabel(
  copy: MonitorCopy,
  item: Pick<LogItem, 'trigger'>
): string {
  return getMonitorTriggerLabel(copy, (item.trigger || 'manual').toLowerCase())
}

export function getLogMentionSearchText(
  copy: MonitorCopy,
  item: Pick<LogItem, 'entityName' | 'trigger'>
): string {
  return [item.entityName, getLogMentionTriggerLabel(copy, item)].join(' ').trim()
}
