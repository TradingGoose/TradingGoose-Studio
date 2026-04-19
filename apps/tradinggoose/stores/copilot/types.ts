import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { CopilotRuntimeModel } from '@/lib/copilot/runtime-models'
import type { ClientToolCallState, ClientToolDisplay } from '@/lib/copilot/tools/client/base-tool'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'

export type ToolState = ClientToolCallState

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
  toolCalls?: CopilotToolCall[]
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
    | { type: 'contexts'; contexts: ChatContext[]; timestamp: number }
  >
  fileAttachments?: MessageFileAttachment[]
  contexts?: ChatContext[]
}

// Contexts attached to a user message
type WorkflowChatContext =
  | { kind: 'workflow'; workflowId: string; label: string }
  | {
      kind: 'current_workflow'
      workflowId: string
      label: string
    }

type SkillChatContext =
  | { kind: 'skill'; skillId: string; workspaceId?: string; label: string }
  | {
      kind: 'current_skill'
      skillId?: string
      workspaceId?: string
      label: string
    }

type IndicatorChatContext =
  | { kind: 'indicator'; indicatorId: string; workspaceId?: string; label: string }
  | {
      kind: 'current_indicator'
      indicatorId?: string
      workspaceId?: string
      label: string
    }

type CustomToolChatContext =
  | { kind: 'custom_tool'; customToolId: string; workspaceId?: string; label: string }
  | {
      kind: 'current_custom_tool'
      customToolId?: string
      workspaceId?: string
      label: string
    }

type McpServerChatContext =
  | { kind: 'mcp_server'; mcpServerId: string; workspaceId?: string; label: string }
  | {
      kind: 'current_mcp_server'
      mcpServerId?: string
      workspaceId?: string
      label: string
    }

export type ChatContext =
  | { kind: 'past_chat'; reviewSessionId: string; label: string }
  | WorkflowChatContext
  | SkillChatContext
  | IndicatorChatContext
  | CustomToolChatContext
  | McpServerChatContext
  | { kind: 'blocks'; blockIds: string[]; label: string }
  | { kind: 'logs'; executionId?: string; label: string }
  | { kind: 'workflow_block'; workflowId: string; blockId: string; label: string }
  | { kind: 'knowledge'; knowledgeId?: string; label: string }
  | { kind: 'templates'; templateId?: string; label: string }
  | { kind: 'docs'; label: string }

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

export interface CopilotLiveReviewTarget {
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string | null
  reviewSessionId: string | null
  draftSessionId: string | null
}

export interface CopilotLiveContext {
  workflowId: string | null
  workspaceId: string | null
  reviewTarget?: CopilotLiveReviewTarget | null
}

export interface CopilotSendRuntimeContext {
  liveContext: CopilotLiveContext
  implicitContexts: ChatContext[]
}

export interface CopilotToolExecutionProvenance {
  workflowId?: string
  contextWorkflowId?: string
  workspaceId?: string
  reviewSessionId?: string
  entityKind?: ReviewEntityKind
  entityId?: string
  draftSessionId?: string
}

export interface CopilotState {
  accessLevel: CopilotAccessLevel
  selectedModel: CopilotRuntimeModel
  agentPrefetch: boolean

  currentChat: CopilotChat | null
  chats: CopilotChat[]
  messages: CopilotMessage[]

  isLoadingChats: boolean
  isSendingMessage: boolean
  isAwaitingContinuation: boolean
  isAborting: boolean

  abortController: AbortController | null
  inputValue: string

  planTodos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  showPlanTodos: boolean

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
  setAgentPrefetch: (prefetch: boolean) => void
  fetchContextUsage: (
    options?: { bill?: boolean; assistantMessageId?: string; workflowId?: string }
  ) => Promise<void>

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
  updatePreviewToolCallState: (
    toolCallState: 'accepted' | 'rejected' | 'error',
    toolCallId?: string
  ) => void
  setToolCallState: (toolCall: any, newState: ClientToolCallState, options?: any) => void
  saveChatMessages: (
    chatId: string,
    options?: { latestTurnStatus?: string | null }
  ) => Promise<void>

  cleanup: () => void
  reset: () => void

  setInputValue: (value: string) => void

  setPlanTodos: (
    todos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  ) => void
  updatePlanTodoStatus: (id: string, status: 'executing' | 'completed') => void
  closePlanTodos: () => void

  handleStreamingResponse: (
    stream: ReadableStream,
    messageId: string,
    isContinuation?: boolean,
    turnProvenance?: CopilotToolExecutionProvenance
  ) => Promise<void>
  handleNewReviewSessionCreation: (
    newReviewSessionId: string,
    workspaceId?: string | null
  ) => Promise<void>

  executeCopilotToolCall: (toolCallId: string) => Promise<void>
  skipCopilotToolCall: (toolCallId: string) => Promise<void>
  executeIntegrationTool: (toolCallId: string) => Promise<void>
  skipIntegrationTool: (toolCallId: string) => void
}

export type CopilotStore = CopilotState & CopilotActions
