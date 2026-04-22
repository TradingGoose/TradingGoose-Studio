'use client'

import type { ComponentType } from 'react'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { ChatContext } from '@/stores/copilot/types'
import type {
  CopilotWorkspaceEntityKind,
  CopilotWorkspaceEntityMentionOption,
} from '../../workspace-entities'

export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

export interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  path: string
  key?: string
  uploading: boolean
  previewUrl?: string
}

export interface UserInputProps {
  workspaceId: string
  onSubmit: (
    message: string,
    fileAttachments?: MessageFileAttachment[],
    contexts?: ChatContext[]
  ) => void
  onAbort?: () => void
  disabled?: boolean
  isLoading?: boolean
  isAborting?: boolean
  placeholder?: string
  className?: string
  accessLevel?: CopilotAccessLevel
  onAccessLevelChange?: (accessLevel: CopilotAccessLevel) => void
  value?: string
  onChange?: (value: string) => void
  panelWidth?: number
  hideContextUsage?: boolean
  clearOnSubmit?: boolean
}

export interface UserInputRef {
  focus: () => void
}

export type MentionOption =
  | 'Chats'
  | CopilotWorkspaceEntityMentionOption
  | 'Workflow Blocks'
  | 'Blocks'
  | 'Knowledge'
  | 'Docs'
  | 'Logs'

export type MentionSubmenu = Exclude<MentionOption, 'Docs'>

export interface MentionPortalStyle {
  top: number
  left: number
  width: number
  maxHeight: number
  showBelow: boolean
}

export interface MentionRange {
  start: number
  end: number
  label: string
}

export interface PastChatItem {
  reviewSessionId: string
  title: string | null
  workflowId: string | null
  updatedAt?: string
}

export interface WorkspaceEntityItem {
  entityKind: CopilotWorkspaceEntityKind
  id: string
  name: string
  color?: string
  description?: string
  functionName?: string
  transport?: string
  enabled?: boolean
  connectionStatus?: string
}

export interface KnowledgeBaseItem {
  id: string
  name: string
}

export interface BlockItem {
  id: string
  name: string
  iconComponent?: ComponentType<any>
  bgColor?: string
}

export interface WorkflowBlockItem extends BlockItem {
  type: string
}

export interface LogItem {
  id: string
  executionId?: string
  level: string
  trigger: string | null
  createdAt: string
  workflowName: string
}

export type MentionItem =
  | PastChatItem
  | WorkspaceEntityItem
  | KnowledgeBaseItem
  | BlockItem
  | WorkflowBlockItem
  | LogItem

export interface MentionSources {
  pastChats: PastChatItem[]
  workspaceEntities: Record<CopilotWorkspaceEntityKind, WorkspaceEntityItem[]>
  knowledgeBases: KnowledgeBaseItem[]
  blocksList: BlockItem[]
  logsList: LogItem[]
  workflowBlocks: WorkflowBlockItem[]
}

export interface AggregatedMentionItem {
  type: MentionSubmenu
  id: string
  value: MentionItem
}
