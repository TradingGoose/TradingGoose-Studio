'use client'

import type { McpTransport } from '@/lib/mcp/types'

export interface McpServerFormData {
  name: string
  transport: McpTransport
  url?: string
  timeout?: number
  headers?: Record<string, string>
}
