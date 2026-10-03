import type { ToolResponse } from '@/tools/types'

export interface MemoryResponse extends ToolResponse {
  output: {
    memories?: any[]
    message?: string
  }
}
