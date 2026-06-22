'use client'

import { type Messages, useMessages } from 'next-intl'
import {
  getMonitorTriggerLabel,
  type MonitorCopy,
} from '@/app/workspace/[workspaceId]/monitor/copy'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'
import type { CopilotWorkspaceEntityKind } from '../../workspace-entities'
import type {
  KnowledgeBaseItem,
  LogItem,
  MentionOption,
  MentionSubmenu,
  PastChatItem,
  WorkspaceEntityItem,
} from './types'

type WorkspaceDashboardMessages = Messages['workspace']['dashboard']
type WorkspaceWidgetsMessages = Messages['workspace']['widgets']

export type CopilotMentionCopy = ReturnType<typeof getCopilotMentionCopy>

export function getCopilotMentionCopy({
  dashboard,
  nav,
  widgets,
}: {
  dashboard: WorkspaceDashboardMessages
  nav: Messages['nav']
  widgets: WorkspaceWidgetsMessages
}) {
  const copilot = widgets.copilot
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
      knowledge: dashboard.pages.knowledge,
      docs: nav.docs,
      logs: dashboard.pages.logs,
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
      knowledge: dashboard.sections.knowledgeBases,
      logs: dashboard.pages.logs,
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
    untitledLabels: {
      chats: copilot.history.newChat,
      workflow: widgets.workflowDropdown.untitledWorkflow,
      skill: widgets.skillDropdown.untitledSkill,
      indicator: widgets.indicatorList.listItem.untitledIndicator,
      custom_tool: widgets.customToolDropdown.untitledCustomTool,
      mcp_server: widgets.mcpDropdown.unnamedServer,
    } satisfies Record<'chats' | CopilotWorkspaceEntityKind, string>,
    matches: copilot.mentions.matches,
    noMatches: copilot.mentions.noMatches,
    loading: copilot.history.loading,
  }
}

export function useCopilotMentionCopy(): CopilotMentionCopy {
  const messages = useMessages()
  const widgets = useWorkspaceWidgetsMessages()

  return getCopilotMentionCopy({
    dashboard: messages.workspace.dashboard,
    nav: messages.nav,
    widgets,
  })
}

export function getMentionOptionLabel(copy: CopilotMentionCopy, option: MentionOption): string {
  return copy.optionLabels[option]
}

export function getMentionSubmenuTitle(copy: CopilotMentionCopy, submenu: MentionSubmenu): string {
  return copy.submenuTitles[submenu]
}

export function getWorkspaceEntityMentionLabel(
  copy: CopilotMentionCopy,
  item: Pick<WorkspaceEntityItem, 'entityKind' | 'name'>
): string {
  return item.name.trim() || copy.untitledLabels[item.entityKind]
}

export function getPastChatMentionLabel(
  copy: CopilotMentionCopy,
  item: Pick<PastChatItem, 'title'>
): string {
  return item.title?.trim() || copy.untitledLabels.chats
}

export function getKnowledgeBaseMentionLabel(item: Pick<KnowledgeBaseItem, 'name'>): string {
  return item.name.trim()
}

export function getLogMentionTriggerLabel(
  copy: MonitorCopy,
  item: Pick<LogItem, 'trigger'>
): string {
  return getMonitorTriggerLabel(copy, (item.trigger ?? 'unknown').toLowerCase())
}

export function getLogMentionSearchText(
  copy: MonitorCopy,
  item: Pick<LogItem, 'entityName' | 'trigger'>
): string {
  return [item.entityName, getLogMentionTriggerLabel(copy, item)].join(' ').trim()
}
