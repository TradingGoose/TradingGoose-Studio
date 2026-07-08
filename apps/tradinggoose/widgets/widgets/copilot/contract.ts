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
})
