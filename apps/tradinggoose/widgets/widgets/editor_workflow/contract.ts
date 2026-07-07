import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowEditorWidgetContract = defineEntityWidgetContract(
  'editor_workflow',
  'Workflow Editor',
  'editor',
  'Edit the selected workflow.',
  'workflowId',
  'workflow-id',
  'Use this for focused workflow editing.',
  'workflowId must exist in the workspace.'
)
