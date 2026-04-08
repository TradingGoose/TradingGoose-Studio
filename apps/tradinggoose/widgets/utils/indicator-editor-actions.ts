import {
  INDICATOR_EDITOR_ACTION_EVENT,
  type IndicatorEditorActionEventDetail,
} from '@/widgets/events'
import {
  createEditorActionsHook,
  createEmitEditorAction,
} from '@/widgets/utils/editor-actions'

type IndicatorAction = IndicatorEditorActionEventDetail['action']

export const useIndicatorEditorActions =
  createEditorActionsHook<IndicatorAction>(INDICATOR_EDITOR_ACTION_EVENT)

export const emitIndicatorEditorAction =
  createEmitEditorAction<IndicatorAction>(INDICATOR_EDITOR_ACTION_EVENT)
