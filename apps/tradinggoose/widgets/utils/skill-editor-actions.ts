import { useEffect, useRef } from 'react'
import {
  SKILL_EDITOR_ACTION_EVENT,
  SKILL_EDITOR_STATE_EVENT,
  type SkillEditorActionEventDetail,
  type SkillEditorStateEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'

interface UseSkillEditorActionsOptions {
  panelId?: string
  widget?: WidgetInstance | null
  onSave?: () => void
}

export function useSkillEditorActions({ panelId, widget, onSave }: UseSkillEditorActionsOptions) {
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    if (!saveRef.current) return

    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<SkillEditorActionEventDetail>).detail
      if (!detail?.action) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      if (detail.action === 'save') {
        saveRef.current?.()
      }
    }

    window.addEventListener(SKILL_EDITOR_ACTION_EVENT, handleAction as EventListener)

    return () => {
      window.removeEventListener(SKILL_EDITOR_ACTION_EVENT, handleAction as EventListener)
    }
  }, [panelId, widget?.key])
}

interface EmitSkillEditorActionOptions {
  action: 'save'
  panelId?: string
  widgetKey?: string
}

export function emitSkillEditorAction({
  action,
  panelId,
  widgetKey,
}: EmitSkillEditorActionOptions) {
  window.dispatchEvent(
    new CustomEvent<SkillEditorActionEventDetail>(SKILL_EDITOR_ACTION_EVENT, {
      detail: {
        action,
        panelId,
        widgetKey,
      },
    })
  )
}

interface UseSkillEditorStateOptions {
  panelId?: string
  widget?: WidgetInstance | null
  onStateChange?: (detail: SkillEditorStateEventDetail) => void
}

export function useSkillEditorState({
  panelId,
  widget,
  onStateChange,
}: UseSkillEditorStateOptions) {
  const stateChangeRef = useRef(onStateChange)
  stateChangeRef.current = onStateChange

  useEffect(() => {
    if (!stateChangeRef.current) return

    const handleState = (event: Event) => {
      const detail = (event as CustomEvent<SkillEditorStateEventDetail>).detail
      if (!detail) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      stateChangeRef.current?.(detail)
    }

    window.addEventListener(SKILL_EDITOR_STATE_EVENT, handleState as EventListener)

    return () => {
      window.removeEventListener(SKILL_EDITOR_STATE_EVENT, handleState as EventListener)
    }
  }, [panelId, widget?.key])
}

interface EmitSkillEditorStateOptions extends SkillEditorStateEventDetail {}

export function emitSkillEditorState({ isDirty, panelId, widgetKey }: EmitSkillEditorStateOptions) {
  window.dispatchEvent(
    new CustomEvent<SkillEditorStateEventDetail>(SKILL_EDITOR_STATE_EVENT, {
      detail: {
        isDirty,
        panelId,
        widgetKey,
      },
    })
  )
}
