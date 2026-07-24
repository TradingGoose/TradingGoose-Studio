import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const mcpEditorWidgetContract = defineEntityWidgetContract(
  'editor_mcp',
  'MCP Editor',
  'editor',
  'Edit an MCP server.',
  'mcpServerId'
)
