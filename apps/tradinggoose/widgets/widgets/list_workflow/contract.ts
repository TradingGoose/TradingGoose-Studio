import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowListWidgetContract = defineEntityWidgetContract(
  'list_workflow',
  'Workflow List',
  'list',
  'List saved workflows.',
  'workflowId',
  'workflow-id',
  'Use workflow ids returned by list_workflows.',
  'workflowId must exist in the workspace.'
)
