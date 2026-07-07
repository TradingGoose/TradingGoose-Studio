import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const skillListWidgetContract = defineEntityWidgetContract(
  'list_skill',
  'Skills',
  'list',
  'List skills.',
  'skillId',
  'skill-id',
  'Use ids returned by list_skills.',
  'skillId must exist in the workspace.'
)
