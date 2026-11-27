import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface SttParams {
  provider: 'whisper' | 'deepgram' | 'elevenlabs' | 'assemblyai' | 'gemini'
  apiKey: string
  model?: string
  audioFile?: UserFile | UserFile[]
  audioFileReference?: UserFile | UserFile[]
  audioUrl?: string
  language?: string
  timestamps?: 'none' | 'sentence' | 'word'
  diarization?: boolean
  translateToEnglish?: boolean
  // AssemblyAI-specific options
  sentiment?: boolean
  entityDetection?: boolean
  piiRedaction?: boolean
  summarization?: boolean
}

export interface TranscriptSegment {
  text: string
  start: number
  end: number
  speaker?: string
  confidence?: number
}

export interface SttResponse extends ToolResponse {
  output: {
    transcript: string
    segments?: TranscriptSegment[]
    language?: string
    duration?: number
    confidence?: number
    // AssemblyAI-specific outputs
    sentiment?: any[]
    entities?: any[]
    summary?: string
  }
}

export interface SttBlockResponse extends ToolResponse {
  output: {
    transcript: string
    segments?: TranscriptSegment[]
    language?: string
    duration?: number
    confidence?: number
    // AssemblyAI-specific outputs
    sentiment?: any[]
    entities?: any[]
    summary?: string
  }
}
