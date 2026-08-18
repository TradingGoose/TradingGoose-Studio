import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import type { CopilotRuntimeModel } from '@/lib/copilot/runtime-models'
import type { ClientToolCallState, ClientToolDisplay } from '@/lib/copilot/tools/client/base-tool'

export interface CopilotToolCall {
  id: string
  name: string
  state: ClientToolCallState
  params?: Record<string, any>
  display?: ClientToolDisplay
  result?: any
  // Immutable execution provenance captured when the tool call is created.
  provenance?: CopilotToolExecutionProvenance
}

export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: { id: number; title: string; url: string; similarity?: number }[]
  contentBlocks?: Array<
    | { type: 'text'; content: string; timestamp: number; itemId?: string }
    | {
        type: 'thinking'
        content: string
        timestamp: number
        itemId?: string
        duration?: number
        startTime?: number
      }
    | { type: 'tool_call'; toolCall: CopilotToolCall; timestamp: number }
  >
  fileAttachments?: MessageFileAttachment[]
  contexts?: ChatContext[]
  isError?: boolean
}

// Contexts attached to a user message
type WorkspaceEntityContextIdFieldByKind = {
  workflow: 'workflowId'
  skill: 'skillId'
  indicator: 'indicatorId'
  knowledge_base: 'knowledgeBaseId'
  custom_tool: 'customToolId'
  mcp_server: 'mcpServerId'
  watchlist: 'watchlistId'
  dashboard_layout: 'dashboardLayoutId'
}

type WorkspaceEntityContextBase<K extends keyof WorkspaceEntityContextIdFieldByKind> = {
  ownerUserId?: string
  label: string
} & (K extends 'knowledge_base' ? { workspaceId: string } : { workspaceId?: string })

type WorkspaceEntityExplicitChatContext = {
  [K in keyof WorkspaceEntityContextIdFieldByKind]: { kind: K } & Record<
    WorkspaceEntityContextIdFieldByKind[K],
    string
  > &
    WorkspaceEntityContextBase<K>
}[keyof WorkspaceEntityContextIdFieldByKind]

type WorkspaceEntityCurrentChatContext =
  | {
      kind: 'current_knowledge_base'
      knowledgeBaseId: string
      workspaceId: string
      label: string
    }
  | {
      kind: 'current_dashboard_layout'
      dashboardLayoutId: string
      workspaceId: string
      ownerUserId: string
      label: string
    }

type WorkspaceEntityChatContext =
  | WorkspaceEntityExplicitChatContext
  | WorkspaceEntityCurrentChatContext

export type ChatContext =
  | { kind: 'past_chat'; reviewSessionId: string; label: string }
  | WorkspaceEntityChatContext
  | { kind: 'blocks'; blockTypes?: string[]; label: string }
  | {
      kind: 'logs' | 'current_logs'
      logId: string
      workspaceId: string
      label: string
    }
  | { kind: 'workflow_block'; workflowId: string; blockId: string; label: string }
  | {
      kind: 'current_monitor'
      monitorId: string
      workspaceId: string
      label: string
    }
  | { kind: 'docs'; label: string }

export interface CopilotDraft {
  text: string
  contexts: ChatContext[]
}

export type CopilotDraftUpdate = CopilotDraft | ((draft: CopilotDraft) => CopilotDraft)

export interface CopilotChat {
  reviewSessionId: string
  workspaceId: string | null
  entityKind: string | null
  entityId: string | null
  draftSessionId: string | null
  title: string | null
  messages: CopilotMessage[]
  messageCount: number
  conversationId?: string | null
  latestTurnStatus?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CopilotSendRuntimeContext {
  workspaceId: string | null
  implicitContexts: ChatContext[]
}

export interface CopilotToolExecutionProvenance {
  contextEntityKind?: ReviewEntityKind
  contextEntityId?: string
  workspaceId?: string
  /**
   * Owner-scoped dashboard layout context candidate. Carried per turn and
   * used only to pin the canonical layout identity for dashboard tools; the
   * authenticated server session owns layout scope.
   */
  dashboardLayoutContext?: {
    entityId: string
    workspaceId: string
    ownerUserId: string
  }
}

export interface CopilotState {
  accessLevel: CopilotAccessLevel
  selectedModel: CopilotRuntimeModel

  currentChat: CopilotChat | null
  chats: CopilotChat[]
  messages: CopilotMessage[]

  isLoadingChats: boolean
  isSendingMessage: boolean
  isAwaitingContinuation: boolean
  isAborting: boolean

  abortController: AbortController | null
  draft: CopilotDraft

  planTodos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>

  // Map of toolCallId -> CopilotToolCall for quick access during streaming
  toolCallsById: Record<string, CopilotToolCall>

  // Context usage tracking for percentage pill
  contextUsage: {
    usage: number
    percentage: number
    model: string
    contextWindow: number
    when: 'start' | 'end'
    estimatedTokens?: number
  } | null
}

export interface CopilotActions {
  setAccessLevel: (accessLevel: CopilotAccessLevel) => void
  setSelectedModel: (model: CopilotStore['selectedModel']) => Promise<void>
  fetchContextUsage: () => Promise<void>

  loadChats: (options?: { workspaceId?: string | null }) => Promise<void>
  selectChat: (chat: CopilotChat) => Promise<void>
  createNewChat: (workspaceId?: string | null) => Promise<void>
  deleteChat: (reviewSessionId: string) => Promise<void>

  sendMessage: (
    message: string,
    options?: {
      fileAttachments?: MessageFileAttachment[]
      contexts?: ChatContext[]
      messageId?: string
      runtimeContext?: CopilotSendRuntimeContext
    }
  ) => Promise<void>
  abortMessage: () => void
  saveChatMessages: (
    chatId: string,
    options?: { latestTurnStatus?: string | null }
  ) => Promise<void>

  reset: () => void

  setDraft: (update: CopilotDraftUpdate) => void

  setPlanTodos: (
    todos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  ) => void
  updatePlanTodoStatus: (id: string, status: 'executing' | 'completed') => void
  handleStreamingResponse: (
    stream: ReadableStream,
    messageId: string,
    isContinuation?: boolean,
    turnProvenance?: CopilotToolExecutionProvenance,
    abortSignal?: AbortSignal
  ) => Promise<void>
  handleNewReviewSessionCreation: (
    newReviewSessionId: string,
    workspaceId?: string | null
  ) => Promise<void>

  executeCopilotToolCall: (toolCallId: string, actionArgs?: Record<string, any>) => Promise<void>
  skipCopilotToolCall: (toolCallId: string) => Promise<void>
}

export type CopilotStore = CopilotState & CopilotActions
