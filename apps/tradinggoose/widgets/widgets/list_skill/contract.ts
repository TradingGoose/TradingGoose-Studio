import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const skillListWidgetContract = defineEntityWidgetContract(
  'list_skill',
  'Skills',
  'list',
  'List skills.',
  'skillId'
)
