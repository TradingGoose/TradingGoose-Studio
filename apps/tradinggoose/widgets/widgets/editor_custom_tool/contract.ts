import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const customToolEditorWidgetContract = defineEntityWidgetContract(
  'editor_custom_tool',
  'Custom Tool Editor',
  'editor',
  'Edit a custom tool.',
  'customToolId'
)
