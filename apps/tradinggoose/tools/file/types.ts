import type { ToolResponse } from '@/tools/types'

export interface FileParserInput {
  filePath: string | string[]
  fileType?: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export interface FileParseResult {
  content: string
  fileType: string
  size: number
  name: string
  binary: boolean
  metadata?: Record<string, unknown>
}

export interface FileParserOutputData {
  /** Array of parsed file results */
  files: FileParseResult[]
  /** Combined text content from all files */
  combinedContent: string
  [key: string]: unknown
}

export interface FileParserOutput extends ToolResponse {
  output: FileParserOutputData
}

export type FileParseApiResponse =
  | { success: true; output: FileParseResult }
  | { success: false; error?: string }

export interface FileParseApiMultiResponse {
  success: true
  results: FileParseApiResponse[]
}
