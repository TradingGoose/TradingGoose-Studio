import type { StoreApi } from 'zustand'
import type { CopilotStore } from '@/stores/copilot/types'

type CopilotStoreResolver = (toolCallId: string) => StoreApi<CopilotStore>

let resolveStoreForToolCall: CopilotStoreResolver | null = null

export function registerCopilotStoreForToolCallResolver(
  resolver: CopilotStoreResolver
): void {
  resolveStoreForToolCall = resolver
}

export function getCopilotStoreForToolCall(toolCallId: string): StoreApi<CopilotStore> {
  if (!resolveStoreForToolCall) {
    throw new Error('Copilot store resolver is not registered')
  }

  return resolveStoreForToolCall(toolCallId)
}
