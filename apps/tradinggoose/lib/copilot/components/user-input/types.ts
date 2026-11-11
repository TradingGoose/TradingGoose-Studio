'use client'

import type { ComponentType, Dispatch, SetStateAction } from 'react'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { ImagePart } from '@/lib/copilot/native/contract'
import type { ChatContext, CopilotDraft } from '@/stores/copilot/types'
import type { CopilotWorkspaceEntityKind } from '../../workspace-entities'

export interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  data?: string
  uploading: boolean
  previewUrl?: string
}

export interface UserInputProps {
  workspaceId: string
  onSubmit: (
    message: string,
    images?: ImagePart[],
    contexts?: ChatContext[],
    submittedDraft?: CopilotDraft
  ) => Promise<boolean> | boolean
  onAbort?: () => void
  isLoading?: boolean
  isAborting?: boolean
  submitDisabled?: boolean
  placeholder?: string
  accessLevel: CopilotAccessLevel
  onAccessLevelChange: (accessLevel: CopilotAccessLevel) => void
  draft: CopilotDraft
  onDraftChange: Dispatch<SetStateAction<CopilotDraft>>
  panelWidth: number
  clearOnSubmit?: boolean
}

export interface UserInputRef {
  focus: () => void
}

export type MentionOption = 'chats' | CopilotWorkspaceEntityKind | 'blocks' | 'docs' | 'logs'

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
  threadId: string
  workspaceId: string | null
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

export interface LogItem {
  id: string
  level: string
  trigger: string | null
  startedAt: string
  entityName: string
}

export type MentionItem = PastChatItem | WorkspaceEntityItem | BlockItem | LogItem

export interface MentionSources {
  pastChats: PastChatItem[]
  workspaceEntities: Record<CopilotWorkspaceEntityKind, WorkspaceEntityItem[]>
  blocksList: BlockItem[]
  logsList: LogItem[]
}

export interface AggregatedMentionItem {
  type: MentionSubmenu
  id: string
  value: MentionItem
}
