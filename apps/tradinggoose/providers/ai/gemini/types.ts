import type { Content, ToolConfig } from '@google/genai'
import type { FunctionCallResponse, ProviderResponse, TimeSegment } from '@/providers/ai/types'

/**
 * Usage metadata from Gemini responses
 */
export interface GeminiUsage {
  promptTokenCount: number
  candidatesTokenCount: number
  cachedContentTokenCount: number
  totalTokenCount: number
}

/**
 * Accumulated state during tool execution loop
 */
export interface ExecutionState {
  contents: Content[]
  tokens: { input: number; output: number; total: number }
  cost: ProviderResponse['cost']
  toolCalls: FunctionCallResponse[]
  toolResults: Record<string, unknown>[]
  iterationCount: number
  modelTime: number
  toolsTime: number
  timeSegments: TimeSegment[]
  usedForcedTools: string[]
  currentToolConfig: ToolConfig | undefined
}

/**
 * Provider type for logging and model lookup
 */
export type GeminiProviderType = 'google' | 'vertex'
