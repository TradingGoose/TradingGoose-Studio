import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const customToolEditorWidgetContract = defineEntityWidgetContract(
  'editor_custom_tool',
  'Custom Tool Editor',
  'editor',
  'Edit a custom tool.',
  'customToolId',
  'custom-tool-id',
  'Use with list_custom_tool through a shared pair color.',
  'customToolId must exist in the workspace.'
)
