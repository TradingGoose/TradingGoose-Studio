import { useEffect, useRef } from 'react'
import { SKILL_EDITOR_ACTION_EVENT, type SkillEditorActionEventDetail } from '@/widgets/events'
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
