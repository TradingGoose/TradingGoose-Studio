/**
 * Copilot Types - Consolidated from various locations
 * This file contains all copilot-related type definitions
 */

import type { ProviderId } from '@/providers/ai/types'

// Tool call state types (from apps/tradinggoose/types/tool-call.ts)
export interface ToolCallState {
  id: string
  name: string
  displayName?: string
  parameters?: Record<string, any>
  state:
    | 'detecting'
    | 'pending'
    | 'executing'
    | 'completed'
    | 'error'
    | 'rejected'
    | 'applied'
    | 'ready_for_review'
    | 'aborted'
    | 'skipped'
    | 'background'
  startTime?: number
  endTime?: number
  duration?: number
  result?: any
  error?: string
  progress?: string
}

export interface ToolCallGroup {
  id: string
  toolCalls: ToolCallState[]
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  startTime?: number
  endTime?: number
  summary?: string
}

export interface InlineContent {
  type: 'text' | 'tool_call'
  content: string
  toolCall?: ToolCallState
}

export interface ParsedMessageContent {
  textContent: string
  toolCalls: ToolCallState[]
  toolGroups: ToolCallGroup[]
  inlineContent?: InlineContent[]
}

// Provider configuration for TradingGoose Agent requests
// This type is only for the `provider` field in requests sent to the TradingGoose Agent
export type CopilotProviderConfig =
  | {
      provider: 'azure-openai'
      model: string
      apiKey?: string
      apiVersion?: string
      endpoint?: string
    }
  | {
      provider: Exclude<ProviderId, 'azure-openai'>
      model?: string
      apiKey?: string
    }
