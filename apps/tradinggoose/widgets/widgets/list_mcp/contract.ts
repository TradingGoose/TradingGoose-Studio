import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const mcpListWidgetContract = defineEntityWidgetContract(
  'list_mcp',
  'MCP Servers',
  'list',
  'List MCP servers.',
  'mcpServerId'
)
