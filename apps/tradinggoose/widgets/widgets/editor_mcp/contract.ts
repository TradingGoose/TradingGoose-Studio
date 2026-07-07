import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const mcpEditorWidgetContract = defineEntityWidgetContract(
  'editor_mcp',
  'MCP Editor',
  'editor',
  'Edit an MCP server.',
  'mcpServerId',
  'mcp-server-id',
  'Use with list_mcp through a shared pair color.',
  'mcpServerId must exist in the workspace.'
)
