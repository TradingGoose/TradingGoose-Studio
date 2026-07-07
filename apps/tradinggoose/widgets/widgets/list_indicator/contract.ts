import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const indicatorListWidgetContract = defineEntityWidgetContract(
  'list_indicator',
  'Indicators',
  'list',
  'List Pine indicators.',
  'indicatorId',
  'indicator-id',
  'Use indicator ids returned by list_indicators.',
  'indicatorId may be a built-in runtime id or workspace custom indicator id.'
)
