import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const customToolListWidgetContract = defineEntityWidgetContract(
  'list_custom_tool',
  'Custom Tools',
  'list',
  'List custom tools.',
  'customToolId'
)
