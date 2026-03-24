import { useEffect } from 'react'
import {
  CUSTOM_TOOL_WIDGET_SELECT_EVENT,
  type CustomToolWidgetSelectEventDetail,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'

const DEFAULT_SCOPE_KEY = 'editor_custom_tool'

interface UseCustomToolSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onCustomToolSelect?: (customToolId: string | null) => void
  scopeKey?: string
}

export function useCustomToolSelectionPersistence({
  onWidgetParamsChange,
  panelId,
  params,
  pairColor = 'gray',
  onCustomToolSelect,
  scopeKey,
}: UseCustomToolSelectionPersistenceOptions) {
  useEffect(() => {
    if (!onWidgetParamsChange && !onCustomToolSelect) {
      return
    }

    const resolvedScopeKey = scopeKey ?? DEFAULT_SCOPE_KEY

    const handleCustomToolSelect = (event: Event) => {
      const detail = (event as CustomEvent<CustomToolWidgetSelectEventDetail>).detail
      if (!detail?.widgetKey) return
      if (resolvedScopeKey && detail.widgetKey !== resolvedScopeKey) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return

      if (pairColor !== 'gray' && onCustomToolSelect) {
        onCustomToolSelect(detail.customToolId ?? null)
        return
      }

      if (pairColor !== 'gray') {
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange?.({
        ...currentParams,
        customToolId: detail.customToolId ?? null,
      })
    }

    window.addEventListener(
      CUSTOM_TOOL_WIDGET_SELECT_EVENT,
      handleCustomToolSelect as EventListener
    )

    return () => {
      window.removeEventListener(
        CUSTOM_TOOL_WIDGET_SELECT_EVENT,
        handleCustomToolSelect as EventListener
      )
    }
  }, [onWidgetParamsChange, onCustomToolSelect, pairColor, panelId, params, scopeKey])
}

interface EmitCustomToolSelectionOptions {
  customToolId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitCustomToolSelectionChange({
  customToolId,
  panelId,
  widgetKey,
}: EmitCustomToolSelectionOptions) {
  if (!widgetKey) return

  window.dispatchEvent(
    new CustomEvent<CustomToolWidgetSelectEventDetail>(CUSTOM_TOOL_WIDGET_SELECT_EVENT, {
      detail: {
        customToolId: customToolId ?? null,
        panelId,
        widgetKey,
      },
    })
  )
}
