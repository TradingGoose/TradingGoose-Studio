import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const workflowChatWidgetContract = defineEntityWidgetContract(
  'workflow_chat',
  'Workflow Chat',
  'utility',
  'Chat against a selected workflow.',
  'workflowId',
  'workflow-id',
  'Pair with an editor_workflow panel by sharing a non-gray color.',
  'workflowId must exist in the workspace.'
)
