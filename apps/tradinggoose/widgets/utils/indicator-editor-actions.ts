import { useEffect, useRef } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import {
  INDICATOR_EDITOR_ACTION_EVENT,
  type IndicatorEditorActionEventDetail,
} from '@/widgets/events'

interface UseIndicatorEditorActionsOptions {
  panelId?: string
  widget?: WidgetInstance | null
  onTabChange?: (tab: 'info' | 'code') => void
  onSave?: () => void
}

export function useIndicatorEditorActions({
  panelId,
  widget,
  onTabChange,
  onSave,
}: UseIndicatorEditorActionsOptions) {
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    if (!onTabChange && !saveRef.current) return

    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<IndicatorEditorActionEventDetail>).detail
      if (!detail?.action) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      if (detail.action === 'set-tab' && detail.tab) {
        onTabChange?.(detail.tab)
        return
      }

      if (detail.action === 'save') {
        saveRef.current?.()
      }
    }

    window.addEventListener(INDICATOR_EDITOR_ACTION_EVENT, handleAction as EventListener)

    return () => {
      window.removeEventListener(INDICATOR_EDITOR_ACTION_EVENT, handleAction as EventListener)
    }
  }, [onTabChange, panelId, widget?.key])
}

interface EmitIndicatorEditorActionOptions {
  action: 'save' | 'set-tab'
  tab?: 'info' | 'code'
  panelId?: string
  widgetKey?: string
}

export function emitIndicatorEditorAction({
  action,
  tab,
  panelId,
  widgetKey,
}: EmitIndicatorEditorActionOptions) {
  window.dispatchEvent(
    new CustomEvent<IndicatorEditorActionEventDetail>(INDICATOR_EDITOR_ACTION_EVENT, {
      detail: {
        action,
        tab,
        panelId,
        widgetKey,
      },
    })
  )
}
