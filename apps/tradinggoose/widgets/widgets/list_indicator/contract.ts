import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const indicatorListWidgetContract = defineEntityWidgetContract(
  'list_indicator',
  'Indicators',
  'list',
  'List Pine indicators.',
  'indicatorId'
)
