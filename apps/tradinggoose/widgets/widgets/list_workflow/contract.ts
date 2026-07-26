import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowListWidgetContract = defineEntityWidgetContract(
  'list_workflow',
  'Workflow List',
  'list',
  'List saved workflows.',
  'workflowId'
)
