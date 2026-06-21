import type { McpTransport } from '@/lib/mcp/types'
import { normalizeStringArray, sanitizeRecord } from '@/lib/utils'
import { readEntitySelectionState, resolveEntityId } from '@/widgets/utils/entity-selection'
import { MCP_SERVER_DEFAULTS } from '@/widgets/utils/mcp-defaults'

export { readEntitySelectionState }

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

export const createMcpSavePayload = (formData: McpServerFormData) => ({
  name: formData.name.trim(),
  description: formData.description.trim() || null,
  transport: formData.transport,
  url: formData.url.trim() || null,
  headers: sanitizeRecord(formData.headers),
  command: formData.command.trim() || null,
  args: normalizeStringArray(formData.args),
  env: sanitizeRecord(formData.env),
  timeout: formData.timeout,
  retries: formData.retries,
  enabled: formData.enabled,
})

export const resolveMcpServerId = ({
  params,
  pairContext,
}: {
  params?: Record<string, unknown> | null
  pairContext?: { mcpServerId?: string | null } | null
}) => resolveEntityId('mcpServerId', { params, pairContext })
