import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowVariablesWidgetContract = defineEntityWidgetContract(
  'workflow_variables',
  'Workflow Variables',
  'editor',
  'Edit selected workflow variables.',
  'workflowId',
  'workflow-id',
  'Use the same workflowId as the workflow editor panel.',
  'workflowId must exist in the workspace.'
)
