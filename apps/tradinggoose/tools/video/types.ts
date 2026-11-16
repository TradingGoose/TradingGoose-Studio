import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface VideoParams {
  provider: 'runway' | 'veo' | 'luma' | 'minimax' | 'falai'
  apiKey: string
  model?: string
  prompt: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  // Provider-specific features
  visualReference?: UserFile // Runway only (required for Runway)
  cameraControl?: {
    // Luma only
    pan?: number
    zoom?: number
    tilt?: number
    truck?: number
    tracking?: boolean
  }
  endpoint?: string // MiniMax: 'pro' | 'standard'
  promptOptimizer?: boolean // MiniMax and Fal.ai MiniMax models
}

export interface VideoResponse extends ToolResponse {
  output: {
    videoUrl: string
    videoFile?: UserFile
    duration?: number
    width?: number
    height?: number
    provider?: string
    model?: string
    jobId?: string
  }
}

export interface VideoBlockResponse extends ToolResponse {
  output: {
    videoUrl: string
    videoFile?: UserFile
    duration?: number
    width?: number
    height?: number
    provider?: string
    model?: string
  }
}
