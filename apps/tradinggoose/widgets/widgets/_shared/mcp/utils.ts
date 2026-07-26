import type { McpTransport } from '@/lib/mcp/types'
import { MCP_SERVER_DEFAULTS } from '@/widgets/utils/mcp-defaults'
import { resolveEntityId } from '@/widgets/widget-contracts'

export interface McpServerFormData {
  name: string
  description: string
  transport: McpTransport
  url: string
  headers: Record<string, string>
  command: string
  args: string[]
  env: Record<string, string>
  timeout: number
  retries: number
  enabled: boolean
}

export const createDefaultMcpServerFormData = (): McpServerFormData => ({
  ...MCP_SERVER_DEFAULTS,
  transport: 'streamable-http',
  headers: {},
  args: [],
  env: {},
})

export const resolveMcpServerId = ({ params }: { params?: Record<string, unknown> | null }) =>
  resolveEntityId('mcpServerId', { params })
