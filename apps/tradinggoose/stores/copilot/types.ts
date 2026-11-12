import type { MastraMessagePart } from '@mastra/core/agent/message-list'
import type { ChatContext } from '@/lib/copilot/chat-context-schema'

export type { ChatContext } from '@/lib/copilot/chat-context-schema'

import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type {
  BrowserAssertion,
  CopilotResponse,
  CopilotToolContext,
  ImagePart,
  Pending,
} from '@/lib/copilot/native/contract'
import type { ClientToolCallState, ClientToolDisplay } from '@/lib/copilot/tools/client/base-tool'
import type { NativeCost, NativeUsage } from '@/lib/mastra/usage'

export interface CopilotToolCall {
  id: string
  name: string
  state: ClientToolCallState
  params?: Record<string, any>
  display?: ClientToolDisplay
  result?: any
  // Native run context, with an explicit workspace choice for unscoped access requests.
  provenance?: CopilotToolContext
  pending?: Pending
  historical?: boolean
  /** Display provenance only: reopened native history is never fresh automatic work. */
  historyOrigin?: true
}

export type NativeImageFile = Pick<
  Extract<MastraMessagePart, { type: 'file' }>,
  'data' | 'mimeType'
>

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  contentBlocks?: Array<
    | { type: 'text'; content: string; timestamp: number }
    | { type: 'thinking'; content: string; timestamp: number }
    | { type: 'tool_call'; toolCall: CopilotToolCall; timestamp: number }
    | { type: 'file'; file: NativeImageFile; timestamp: number }
  >
  contexts?: ChatContext[]
  isError?: boolean
  usage?: NativeUsage
  cost?: NativeCost
}

export interface CopilotDraft {
  text: string
  contexts: ChatContext[]
}

export type CopilotDraftUpdate = CopilotDraft | ((draft: CopilotDraft) => CopilotDraft)

export interface CopilotChat {
  threadId: string
  workspaceId: string | null
  title: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CopilotSendRuntimeContext {
  workspaceId: string | null
  implicitContexts: ChatContext[]
}

/** Transient UI ownership only; never native, business or financial authority. */
export interface WorkflowChatDeploymentRequest {
  id: string
  toolCallId: string
  workflowId: string
  workspaceId: string
  opened: boolean
  isCurrent: () => boolean
}

export interface CopilotState {
  accessLevel: CopilotAccessLevel
  selectedModel: string | null

  currentChat: CopilotChat | null
  conversationWorkspaceId: string | null
  currentRunId: string | null
  workflowChatDeployment: WorkflowChatDeploymentRequest | null
  lastNativeOutcome: CopilotResponse | null
  error: string | null
  historyRefreshError: string | null
  isRefreshingHistory: boolean
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
}

export interface CopilotActions {
  setAccessLevel: (accessLevel: CopilotAccessLevel) => void
  setSelectedModel: (model: CopilotStore['selectedModel']) => Promise<void>
  refreshCurrentHistory: () => Promise<void>

  loadChats: (options?: { workspaceId?: string | null }) => Promise<void>
  selectChat: (chat: CopilotChat) => Promise<void>
  createNewChat: (workspaceId?: string | null) => Promise<void>
  deleteChat: (threadId: string) => Promise<void>

  sendMessage: (
    message: string,
    options?: {
      images?: ImagePart[]
      contexts?: ChatContext[]
      submittedDraft?: CopilotDraft
      messageId?: string
      runtimeContext?: CopilotSendRuntimeContext
    }
  ) => Promise<boolean>
  abortMessage: () => Promise<boolean>

  reset: () => void

  setDraft: (update: CopilotDraftUpdate) => void

  setPlanTodos: (
    todos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  ) => void
  updatePlanTodoStatus: (id: string, status: 'executing' | 'completed') => void
  readPendingTool: (toolCallId: string) => Promise<Pending>
  authorizeToolWorkspace: (toolCallId: string, workspaceId?: string) => Promise<string>
  submitBrowserAssertion: (toolCallId: string, assertion: BrowserAssertion) => Promise<void>
  readbackCopilotToolCall: (
    toolCallId: string,
    readback?: { credentialId?: string }
  ) => Promise<void>
  openWorkflowChatDeployment: (
    toolCallId: string,
    scope: { workflowId: string; workspaceId: string }
  ) => Promise<void>
  settleWorkflowChatDeployment: (
    id: string,
    outcome: 'opened' | 'closed' | 'error',
    message?: string
  ) => void
  recordToolFailure: (toolCallId: string, message: string) => void

  executeCopilotToolCall: (toolCallId: string, actionArgs?: Record<string, any>) => Promise<void>
  skipCopilotToolCall: (toolCallId: string) => Promise<void>
}

export type CopilotStore = CopilotState & CopilotActions
