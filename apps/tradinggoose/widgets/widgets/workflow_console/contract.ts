import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowConsoleWidgetContract = defineEntityWidgetContract(
  'workflow_console',
  'Workflow Console',
  'utility',
  'Inspect workflow execution output.',
  'workflowId'
)
