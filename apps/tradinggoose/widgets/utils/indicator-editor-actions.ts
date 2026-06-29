import { useEffect, useRef } from 'react'
import {
  INDICATOR_EDITOR_ACTION_EVENT,
  type IndicatorEditorActionEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'

interface UseIndicatorEditorActionsOptions {
  panelId?: string
  widget?: WidgetInstance | null
  onExport?: () => void
  onTabChange?: (tab: 'info' | 'code') => void
  onSave?: () => void
  onVerify?: () => void
}

export function useIndicatorEditorActions({
  panelId,
  widget,
  onExport,
  onTabChange,
  onSave,
  onVerify,
}: UseIndicatorEditorActionsOptions) {
  const exportRef = useRef(onExport)
  exportRef.current = onExport
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const verifyRef = useRef(onVerify)
  verifyRef.current = onVerify

  useEffect(() => {
    if (!onTabChange && !exportRef.current && !saveRef.current && !verifyRef.current) return

    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<IndicatorEditorActionEventDetail>).detail
      if (!detail?.action) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      if (detail.action === 'export') {
        exportRef.current?.()
        return
      }

      if (detail.action === 'save') {
        saveRef.current?.()
        return
      }

      if (detail.action === 'verify') {
        verifyRef.current?.()
      }
    }

    window.addEventListener(INDICATOR_EDITOR_ACTION_EVENT, handleAction as EventListener)

    return () => {
      window.removeEventListener(INDICATOR_EDITOR_ACTION_EVENT, handleAction as EventListener)
    }
  }, [onTabChange, panelId, widget?.key])
}

interface EmitIndicatorEditorActionOptions {
  action: 'export' | 'save' | 'verify'
  panelId?: string
  widgetKey?: string
}

export function emitIndicatorEditorAction({
  action,
  panelId,
  widgetKey,
}: EmitIndicatorEditorActionOptions) {
  window.dispatchEvent(
    new CustomEvent<IndicatorEditorActionEventDetail>(INDICATOR_EDITOR_ACTION_EVENT, {
      detail: {
        action,
        panelId,
        widgetKey,
      },
    })
  )
}
