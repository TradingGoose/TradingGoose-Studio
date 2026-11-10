import type { ToolResponse } from '@/tools/types'

export interface VisionParams {
  apiKey?: string
  imageUrl?: string
  imageFile?: any
  model?: string
  prompt?: string
}

export interface VisionResponse extends ToolResponse {
  output: {
    content: string
    model?: string
    tokens?: number
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    cost?: import('@/lib/mastra/usage').NativeCost
  }
}
