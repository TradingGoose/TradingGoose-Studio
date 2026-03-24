import { useEffect, useRef } from 'react'
import { MCP_EDITOR_ACTION_EVENT, type McpEditorActionEventDetail } from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'

interface UseMcpEditorActionsOptions {
  panelId?: string
  widget?: WidgetInstance | null
  onSave?: () => void
  onRefresh?: () => void
  onClose?: () => void
  onReset?: () => void
  onTest?: () => void
}

export function useMcpEditorActions({
  panelId,
  widget,
  onSave,
  onRefresh,
  onClose,
  onReset,
  onTest,
}: UseMcpEditorActionsOptions) {
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const resetRef = useRef(onReset)
  resetRef.current = onReset
  const testRef = useRef(onTest)
  testRef.current = onTest

  useEffect(() => {
    if (
      !saveRef.current &&
      !refreshRef.current &&
      !closeRef.current &&
      !resetRef.current &&
      !testRef.current
    ) {
      return
    }

    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<McpEditorActionEventDetail>).detail
      if (!detail?.action) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      if (detail.action === 'save') {
        saveRef.current?.()
        return
      }

      if (detail.action === 'refresh') {
        refreshRef.current?.()
        return
      }

      if (detail.action === 'close') {
        closeRef.current?.()
        return
      }

      if (detail.action === 'reset') {
        resetRef.current?.()
        return
      }

      if (detail.action === 'test') {
        testRef.current?.()
      }
    }

    window.addEventListener(MCP_EDITOR_ACTION_EVENT, handleAction as EventListener)

    return () => {
      window.removeEventListener(MCP_EDITOR_ACTION_EVENT, handleAction as EventListener)
    }
  }, [panelId, widget?.key])
}

interface EmitMcpEditorActionOptions {
  action: 'save' | 'refresh' | 'close' | 'reset' | 'test'
  panelId?: string
  widgetKey?: string
}

export function emitMcpEditorAction({ action, panelId, widgetKey }: EmitMcpEditorActionOptions) {
  window.dispatchEvent(
    new CustomEvent<McpEditorActionEventDetail>(MCP_EDITOR_ACTION_EVENT, {
      detail: {
        action,
        panelId,
        widgetKey,
      },
    })
  )
}
