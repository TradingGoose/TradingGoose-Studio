import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const skillEditorWidgetContract = defineEntityWidgetContract(
  'editor_skill',
  'Skill Editor',
  'editor',
  'Edit a skill.',
  'skillId'
)
