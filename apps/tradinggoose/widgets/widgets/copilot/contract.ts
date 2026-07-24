import { defineWidgetContract } from '@/widgets/widget-contract-types'

const COPILOT_ENTITY_REFERENCE_FIELDS = [
  'workflowId',
  'skillId',
  'indicatorId',
  'customToolId',
  'mcpServerId',
  'watchlistId',
] as const

export const copilotWidgetContract = defineWidgetContract({
  key: 'copilot',
  title: 'Copilot',
  category: 'utility',
  description: 'Workspace copilot panel.',
  editable: true,
  editableFields: [...COPILOT_ENTITY_REFERENCE_FIELDS],
  linkedParamFields: [...COPILOT_ENTITY_REFERENCE_FIELDS],
  defaultParams: null,
})
