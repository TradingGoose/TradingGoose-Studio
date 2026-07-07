import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const mcpListWidgetContract = defineEntityWidgetContract(
  'list_mcp',
  'MCP Servers',
  'list',
  'List MCP servers.',
  'mcpServerId',
  'mcp-server-id',
  'Use ids returned by list_mcp_servers.',
  'mcpServerId must exist in the workspace.'
)
