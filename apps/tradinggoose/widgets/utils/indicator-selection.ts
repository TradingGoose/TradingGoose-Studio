import { useEffect } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'
import {
  INDICATOR_WIDGET_SELECT_EVENT,
  type IndicatorWidgetSelectEventDetail,
} from '@/widgets/events'

interface UseIndicatorSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onIndicatorSelect?: (indicatorId: string | null) => void
}

export function useIndicatorSelectionPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  params,
  pairColor = 'gray',
  onIndicatorSelect,
}: UseIndicatorSelectionPersistenceOptions) {
  useEffect(() => {
    if (!onWidgetParamsChange && !onIndicatorSelect) {
      return
    }

    const handleIndicatorSelect = (event: Event) => {
      const detail = (event as CustomEvent<IndicatorWidgetSelectEventDetail>).detail
      if (!detail) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      if (pairColor !== 'gray' && onIndicatorSelect) {
        onIndicatorSelect(detail.indicatorId ?? null)
        return
      }

      if (pairColor !== 'gray') {
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange({
        ...currentParams,
        indicatorId: detail.indicatorId ?? null,
      })
    }

    window.addEventListener(INDICATOR_WIDGET_SELECT_EVENT, handleIndicatorSelect as EventListener)

    return () => {
      window.removeEventListener(INDICATOR_WIDGET_SELECT_EVENT, handleIndicatorSelect as EventListener)
    }
  }, [onWidgetParamsChange, onIndicatorSelect, pairColor, panelId, params, widget?.key])
}

interface EmitIndicatorSelectionOptions {
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
}

export function emitIndicatorSelectionChange({
  indicatorId,
  panelId,
  widgetKey,
}: EmitIndicatorSelectionOptions) {
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
