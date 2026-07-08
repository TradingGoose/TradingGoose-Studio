import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const indicatorEditorWidgetContract = defineEntityWidgetContract(
  'editor_indicator',
  'Indicator Editor',
  'editor',
  'Edit a Pine indicator.',
  'indicatorId'
)
