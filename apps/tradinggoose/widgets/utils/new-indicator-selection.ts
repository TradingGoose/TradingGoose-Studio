import { useEffect } from 'react'
import {
  INDICATOR_WIDGET_SELECT_EVENT,
  type IndicatorWidgetSelectEventDetail,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'

const DEFAULT_SCOPE_KEY = 'new_editor_indicator'

interface UseNewIndicatorSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onIndicatorSelect?: (indicatorId: string | null) => void
  scopeKey?: string
}

export function useNewIndicatorSelectionPersistence({
  onWidgetParamsChange,
  panelId,
  params,
  pairColor = 'gray',
  onIndicatorSelect,
  scopeKey,
}: UseNewIndicatorSelectionPersistenceOptions) {
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

interface EmitNewIndicatorSelectionOptions {
  indicatorId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitNewIndicatorSelectionChange({
  indicatorId,
  panelId,
  widgetKey,
}: EmitNewIndicatorSelectionOptions) {
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
