import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import type { McpTransport } from '@/lib/mcp/types'
import { normalizeStringArray, sanitizeRecord } from '@/lib/utils'
import { MCP_SERVER_DEFAULTS } from '@/widgets/utils/draft-defaults'
import { resolveEntityId } from '@/widgets/widgets/entity_review/resolve-entity-id'

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

export const createFormDataFromServer = (server: Partial<McpServerWithStatus>): McpServerFormData => ({
  name: server.name ?? MCP_SERVER_DEFAULTS.name,
  description: server.description ?? MCP_SERVER_DEFAULTS.description,
  transport: server.transport ?? 'streamable-http',
  url: server.url ?? MCP_SERVER_DEFAULTS.url,
  headers:
    server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers)
      ? { ...server.headers }
      : {},
  command: server.command ?? MCP_SERVER_DEFAULTS.command,
  args: Array.isArray(server.args) ? [...server.args] : [],
  env:
    server.env && typeof server.env === 'object' && !Array.isArray(server.env)
      ? { ...server.env }
      : {},
  timeout: server.timeout ?? MCP_SERVER_DEFAULTS.timeout,
  retries: server.retries ?? MCP_SERVER_DEFAULTS.retries,
  enabled: server.enabled ?? MCP_SERVER_DEFAULTS.enabled,
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
