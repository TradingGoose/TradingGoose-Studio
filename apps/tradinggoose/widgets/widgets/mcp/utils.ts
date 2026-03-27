import type { McpTransport } from '@/lib/mcp/types'

export interface McpServerFormData {
  transport: McpTransport
  url?: string
  timeout?: number
  headers?: Record<string, string>
}

export const createDefaultMcpServerFormData = (): McpServerFormData => ({
  transport: 'streamable-http',
  url: '',
  timeout: 30000,
  headers: {},
})

export const resolveMcpServerId = ({
  params,
  pairContext,
}: {
  params?: Record<string, unknown> | null
  pairContext?: { mcpServerId?: string | null } | null
}) => {
  if (pairContext && Object.hasOwn(pairContext, 'mcpServerId')) {
    const value = pairContext.mcpServerId
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }

  if (!params || typeof params !== 'object') return null

  const value = params.mcpServerId
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
