import type {
  CopilotStore,
  CopilotToolExecutionProvenance,
} from '@/stores/copilot/types'

export interface StreamingContext {
  messageId: string
  provenance?: CopilotToolExecutionProvenance
  contentBlocks: any[]
  textBlocksByItemId: Map<string, any>
  thinkingBlocksByItemId: Map<string, any>
  pendingAutoExecutionToolCallIds?: Set<string>
  newReviewSessionId?: string
  awaitingTools?: boolean
  streamComplete?: boolean
}

export type SSEHandler = (
  data: any,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) => Promise<void> | void

const streamingUpdateQueue = new Map<string, StreamingContext>()
let streamingUpdateRAF: number | null = null

function createOptimizedContentBlocks(contentBlocks: any[]): any[] {
  const result: any[] = new Array(contentBlocks.length)
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    result[i] = { ...block }
  }
  return result
}

export function updateStreamingMessage(set: any, context: StreamingContext) {
  streamingUpdateQueue.set(context.messageId, context)
  if (streamingUpdateRAF !== null) {
    return
  }

  streamingUpdateRAF = requestAnimationFrame(() => {
    const updates = new Map(streamingUpdateQueue)
    streamingUpdateQueue.clear()
    streamingUpdateRAF = null
    set((state: CopilotStore) => {
      if (updates.size === 0) return state
      const messages = state.messages
      const lastMessage = messages[messages.length - 1]
      const lastMessageUpdate = lastMessage ? updates.get(lastMessage.id) : null
      if (updates.size === 1 && lastMessageUpdate) {
        const newMessages = [...messages]
        newMessages[messages.length - 1] = {
          ...lastMessage,
          content: '',
          contentBlocks:
            lastMessageUpdate.contentBlocks.length > 0
              ? createOptimizedContentBlocks(lastMessageUpdate.contentBlocks)
              : [],
        }
        return { messages: newMessages }
      }
      return {
        messages: messages.map((msg) => {
          const update = updates.get(msg.id)
          if (update) {
            return {
              ...msg,
              content: '',
              contentBlocks:
                update.contentBlocks.length > 0
                  ? createOptimizedContentBlocks(update.contentBlocks)
                  : [],
            }
          }
          return msg
        }),
      }
    })
  })
}

export function resetStreamingQueue() {
  if (streamingUpdateRAF !== null) {
    cancelAnimationFrame(streamingUpdateRAF)
    streamingUpdateRAF = null
  }
  streamingUpdateQueue.clear()
}
