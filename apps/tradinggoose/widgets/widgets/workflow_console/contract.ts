import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowConsoleWidgetContract = defineEntityWidgetContract(
  'workflow_console',
  'Workflow Console',
  'utility',
  'Inspect workflow execution output.',
  'workflowId',
  'workflow-id',
  'Use alongside workflow editor/chat for the same workflow.',
  'workflowId must exist in the workspace.'
)
