import type { CopilotStore } from '@/stores/copilot/types'

export interface StreamingContext {
  messageId: string
  accumulatedContent: any
  contentBlocks: any[]
  currentTextBlock: any | null
  isInThinkingBlock: boolean
  currentThinkingBlock: any | null
  pendingContent: string
  newChatId?: string
  doneEventCount: number
  streamComplete?: boolean
}

export type SSEHandler = (
  data: any,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) => Promise<void> | void

// Debounced UI update queue for smoother streaming
const streamingUpdateQueue = new Map<string, StreamingContext>()
let streamingUpdateRAF: number | null = null
let lastBatchTime = 0
const MIN_BATCH_INTERVAL = 16
const MAX_BATCH_INTERVAL = 50
const MAX_QUEUE_SIZE = 5

function createOptimizedContentBlocks(contentBlocks: any[]): any[] {
  const result: any[] = new Array(contentBlocks.length)
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    result[i] = { ...block }
  }
  return result
}

export function updateStreamingMessage(set: any, context: StreamingContext) {
  const now = performance.now()
  streamingUpdateQueue.set(context.messageId, context)
  const timeSinceLastBatch = now - lastBatchTime
  const shouldFlushImmediately =
    streamingUpdateQueue.size >= MAX_QUEUE_SIZE || timeSinceLastBatch > MAX_BATCH_INTERVAL

  if (streamingUpdateRAF === null) {
    const scheduleUpdate = () => {
      streamingUpdateRAF = requestAnimationFrame(() => {
        const updates = new Map(streamingUpdateQueue)
        streamingUpdateQueue.clear()
        streamingUpdateRAF = null
        lastBatchTime = performance.now()
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

    if (shouldFlushImmediately) {
      scheduleUpdate()
    } else {
      const delay = Math.max(MIN_BATCH_INTERVAL - timeSinceLastBatch, 0)
      setTimeout(scheduleUpdate, delay)
    }
  }
}

export function resetStreamingQueue() {
  if (streamingUpdateRAF !== null) {
    cancelAnimationFrame(streamingUpdateRAF)
    streamingUpdateRAF = null
  }
  streamingUpdateQueue.clear()
}
