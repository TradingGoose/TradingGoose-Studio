import { createLogger } from '@/lib/logs/console/logger'
import type { CopilotRuntimeModel } from '@/lib/copilot/runtime-models'
import type { ChatContext } from '@/stores/copilot/types'
import type { ProviderId } from '@/providers/ai/types'

const logger = createLogger('CopilotAPI')

/**
 * Citation interface for documentation references
 */
export interface Citation {
  id: number
  title: string
  url: string
  similarity?: number
}

/**
 * Message interface for copilot conversations
 */
export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: Citation[]
  toolCalls?: any[]
  contentBlocks?: any[]
  fileAttachments?: any[]
  contexts?: any[]
}

/**
 * Chat interface for copilot conversations
 */
export interface CopilotChat {
  reviewSessionId: string
  workspaceId: string | null
  channelId: string | null
  entityKind: string | null
  entityId: string | null
  draftSessionId: string | null
  conversationId?: string | null
  latestTurnStatus?: string | null
  title: string | null
  messages: CopilotMessage[]
  messageCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * File attachment interface for message requests
 */
export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

/**
 * Request interface for sending messages
 */
export interface SendMessageRequest {
  message: string
  userMessageId?: string // ID from frontend for the user message
  reviewSessionId?: string
  channelId?: string
  workflowId?: string
  workspaceId?: string
  model?: CopilotRuntimeModel
  provider?: ProviderId
  prefetch?: boolean
  stream?: boolean
  fileAttachments?: MessageFileAttachment[]
  abortSignal?: AbortSignal
  contexts?: ChatContext[]
}

/**
 * Base API response interface
 */
export interface ApiResponse {
  success: boolean
  error?: string
  status?: number
}

/**
 * Streaming response interface
 */
export interface StreamingResponse extends ApiResponse {
  stream?: ReadableStream
}

/**
 * Handle API errors and return user-friendly error messages
 */
async function handleApiError(response: Response, defaultMessage: string): Promise<string> {
  try {
    const data = await response.json()
    return (data && (data.error || data.message)) || defaultMessage
  } catch {
    return `${defaultMessage} (${response.status})`
  }
}

/**
 * Send a streaming message to the copilot chat API
 * This is the main API endpoint that handles all chat operations
 */
export async function sendStreamingMessage(
  request: SendMessageRequest
): Promise<StreamingResponse> {
  try {
    const { abortSignal, ...requestBody } = request
    try {
      const preview = Array.isArray((requestBody as any).contexts)
        ? (requestBody as any).contexts.map((c: any) => ({
            kind: c?.kind,
            reviewSessionId: c?.reviewSessionId,
            workflowId: c?.workflowId,
            label: c?.label,
          }))
        : undefined
      logger.info('Preparing to send streaming message', {
        channelId: (requestBody as any).channelId,
        hasContexts: Array.isArray((requestBody as any).contexts),
        contextsCount: Array.isArray((requestBody as any).contexts)
          ? (requestBody as any).contexts.length
          : 0,
        contextsPreview: preview,
      })
    } catch {}
    const response = await fetch('/api/copilot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, stream: true }),
      signal: abortSignal,
      credentials: 'include', // Include cookies for session authentication
    })

    if (!response.ok) {
      const errorMessage = await handleApiError(response, 'Failed to send streaming message')
      return {
        success: false,
        error: errorMessage,
        status: response.status,
      }
    }

    if (!response.body) {
      return {
        success: false,
        error: 'No response body received',
        status: 500,
      }
    }

    return {
      success: true,
      stream: response.body,
    }
  } catch (error) {
    // Handle AbortError gracefully - this is expected when user aborts
    if (error instanceof Error && error.name === 'AbortError') {
      logger.info('Streaming message was aborted by user')
      return {
        success: false,
        error: 'Request was aborted',
      }
    }

    logger.error('Failed to send streaming message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
