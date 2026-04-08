import {
  SKILL_EDITOR_ACTION_EVENT,
  type SkillEditorActionEventDetail,
} from '@/widgets/events'
import {
  createEditorActionsHook,
  createEmitEditorAction,
} from '@/widgets/utils/editor-actions'

type SkillAction = SkillEditorActionEventDetail['action']

export const useSkillEditorActions =
  createEditorActionsHook<SkillAction>(SKILL_EDITOR_ACTION_EVENT)

export const emitSkillEditorAction =
  createEmitEditorAction<SkillAction>(SKILL_EDITOR_ACTION_EVENT)
