import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const indicatorEditorWidgetContract = defineEntityWidgetContract(
  'editor_indicator',
  'Indicator Editor',
  'editor',
  'Edit a Pine indicator.',
  'indicatorId',
  'indicator-id',
  'Use with list_indicator through a shared pair color.',
  'indicatorId may be a built-in runtime id or workspace custom indicator id.'
)
