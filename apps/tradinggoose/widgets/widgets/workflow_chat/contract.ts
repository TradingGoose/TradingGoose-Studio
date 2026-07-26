import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowChatWidgetContract = defineEntityWidgetContract(
  'workflow_chat',
  'Workflow Chat',
  'utility',
  'Chat against a selected workflow.',
  'workflowId'
)
