import { defineWidgetContract } from '@/widgets/widget-contract-types'

export const copilotWidgetContract = defineWidgetContract({
  key: 'copilot',
  title: 'Copilot',
  category: 'utility',
  description: 'Workspace copilot panel.',
  editable: true,
  editableFields: [],
  linkedParamFields: [],
  defaultParams: null,
  examples: [{ widgetKey: 'copilot', params: null }],
  bestPractices: ['Copilot widget params are intentionally not persisted.'],
  validationHints: ['params are always serialized as null.'],
})
