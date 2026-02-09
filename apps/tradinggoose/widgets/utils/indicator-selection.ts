import { useEffect } from 'react'
import {
  INDICATOR_WIDGET_SELECT_EVENT,
  type IndicatorWidgetSelectEventDetail,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'

const DEFAULT_SCOPE_KEY = 'editor_indicator'

interface UseIndicatorSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onIndicatorSelect?: (indicatorId: string | null) => void
  scopeKey?: string
}

export function useIndicatorSelectionPersistence({
  onWidgetParamsChange,
  panelId,
  params,
  pairColor = 'gray',
  onIndicatorSelect,
  scopeKey,
}: UseIndicatorSelectionPersistenceOptions) {
  useEffect(() => {
    if (!onWidgetParamsChange && !onIndicatorSelect) {
      return
    }

    const resolvedScopeKey = scopeKey ?? DEFAULT_SCOPE_KEY

    const handleIndicatorSelect = (event: Event) => {
      const detail = (event as CustomEvent<IndicatorWidgetSelectEventDetail>).detail
      if (!detail?.widgetKey) return
      if (resolvedScopeKey && detail.widgetKey !== resolvedScopeKey) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return

      if (pairColor !== 'gray' && onIndicatorSelect) {
        onIndicatorSelect(detail.indicatorId ?? null)
        return
      }

      if (pairColor !== 'gray') {
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange?.({
        ...currentParams,
        pineIndicatorId: detail.indicatorId ?? null,
      })
    }

    window.addEventListener(INDICATOR_WIDGET_SELECT_EVENT, handleIndicatorSelect as EventListener)

    return () => {
      window.removeEventListener(
        INDICATOR_WIDGET_SELECT_EVENT,
        handleIndicatorSelect as EventListener
      )
    }
  }, [onWidgetParamsChange, onIndicatorSelect, pairColor, panelId, params, scopeKey])
}

interface EmitIndicatorSelectionOptions {
  indicatorId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitIndicatorSelectionChange({
  indicatorId,
  panelId,
  widgetKey,
}: EmitIndicatorSelectionOptions) {
  if (!widgetKey) return

  window.dispatchEvent(
    new CustomEvent<IndicatorWidgetSelectEventDetail>(INDICATOR_WIDGET_SELECT_EVENT, {
      detail: {
        indicatorId: indicatorId ?? null,
        panelId,
        widgetKey,
      },
    })
  )
}
