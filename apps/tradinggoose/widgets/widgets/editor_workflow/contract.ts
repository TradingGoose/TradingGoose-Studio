import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowEditorWidgetContract = defineEntityWidgetContract(
  'editor_workflow',
  'Workflow Editor',
  'editor',
  'Edit the selected workflow.',
  'workflowId'
)
