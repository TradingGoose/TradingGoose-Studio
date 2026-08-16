'use client'

import type { ComponentType, Dispatch, SetStateAction } from 'react'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { ChatContext, CopilotDraft, MessageFileAttachment } from '@/stores/copilot/types'
import type { CopilotWorkspaceEntityKind } from '../../workspace-entities'

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
  draft: CopilotDraft
  onDraftChange: Dispatch<SetStateAction<CopilotDraft>>
  panelWidth?: number
  hideContextUsage?: boolean
  clearOnSubmit?: boolean
}

export interface UserInputRef {
  focus: () => void
}

export type MentionOption =
  | 'chats'
  | CopilotWorkspaceEntityKind
  | 'workflow_blocks'
  | 'blocks'
  | 'docs'
  | 'logs'

export type MentionSubmenu = Exclude<MentionOption, 'docs'>

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
  contextKey: string
}

export interface PastChatItem {
  reviewSessionId: string
  title: string | null
}

export interface WorkspaceEntityItem {
  entityKind: CopilotWorkspaceEntityKind
  id: string
  name: string
  ownerUserId?: string
  color?: string
  description?: string
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
  level: string
  trigger: string | null
  startedAt: string
  entityName: string
}

export type MentionItem =
  | PastChatItem
  | WorkspaceEntityItem
  | BlockItem
  | WorkflowBlockItem
  | LogItem

export interface MentionSources {
  pastChats: PastChatItem[]
  workspaceEntities: Record<CopilotWorkspaceEntityKind, WorkspaceEntityItem[]>
  blocksList: BlockItem[]
  logsList: LogItem[]
  workflowBlocks: WorkflowBlockItem[]
}

export interface AggregatedMentionItem {
  type: MentionSubmenu
  id: string
  value: MentionItem
}
