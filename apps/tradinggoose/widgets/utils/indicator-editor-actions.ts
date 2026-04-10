import { useEffect, useRef } from 'react'
import {
  INDICATOR_EDITOR_ACTION_EVENT,
  INDICATOR_EDITOR_STATE_EVENT,
  type IndicatorEditorActionEventDetail,
  type IndicatorEditorStateEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'

interface UseIndicatorEditorActionsOptions {
  panelId?: string
  widget?: WidgetInstance | null
  onTabChange?: (tab: 'info' | 'code') => void
  onSave?: () => void
  onVerify?: () => void
}

export function useIndicatorEditorActions({
  panelId,
  widget,
  onTabChange,
  onSave,
  onVerify,
}: UseIndicatorEditorActionsOptions) {
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const verifyRef = useRef(onVerify)
  verifyRef.current = onVerify

  useEffect(() => {
    if (!onTabChange && !saveRef.current && !verifyRef.current) return

    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<IndicatorEditorActionEventDetail>).detail
      if (!detail?.action) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

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
  action: 'save' | 'verify'
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

interface UseIndicatorEditorStateOptions {
  panelId?: string
  widget?: WidgetInstance | null
  onStateChange?: (detail: IndicatorEditorStateEventDetail) => void
}

export function useIndicatorEditorState({
  panelId,
  widget,
  onStateChange,
}: UseIndicatorEditorStateOptions) {
  const stateChangeRef = useRef(onStateChange)
  stateChangeRef.current = onStateChange

  useEffect(() => {
    if (!stateChangeRef.current) return

    const handleState = (event: Event) => {
      const detail = (event as CustomEvent<IndicatorEditorStateEventDetail>).detail
      if (!detail) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      stateChangeRef.current?.(detail)
    }

    window.addEventListener(INDICATOR_EDITOR_STATE_EVENT, handleState as EventListener)

    return () => {
      window.removeEventListener(INDICATOR_EDITOR_STATE_EVENT, handleState as EventListener)
    }
  }, [panelId, widget?.key])
}

interface EmitIndicatorEditorStateOptions extends IndicatorEditorStateEventDetail {}

export function emitIndicatorEditorState({
  isDirty,
  panelId,
  widgetKey,
}: EmitIndicatorEditorStateOptions) {
  window.dispatchEvent(
    new CustomEvent<IndicatorEditorStateEventDetail>(INDICATOR_EDITOR_STATE_EVENT, {
      detail: {
        isDirty,
        panelId,
        widgetKey,
      },
    })
  )
}
