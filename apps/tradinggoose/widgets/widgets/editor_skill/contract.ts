import { defineEntityWidgetContract } from '@/widgets/widget-contract-types'

export const skillEditorWidgetContract = defineEntityWidgetContract(
  'editor_skill',
  'Skill Editor',
  'editor',
  'Edit a skill.',
  'skillId',
  'skill-id',
  'Use with list_skill through a shared pair color.',
  'skillId must exist in the workspace.'
)
