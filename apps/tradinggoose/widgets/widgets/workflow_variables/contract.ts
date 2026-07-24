import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowVariablesWidgetContract = defineEntityWidgetContract(
  'workflow_variables',
  'Workflow Variables',
  'utility',
  'Edit selected workflow variables.',
  'workflowId'
)
