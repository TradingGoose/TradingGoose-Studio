import { useEffect } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import {
  WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT,
  type WatchlistWidgetUpdateEventDetail,
} from '@/widgets/events'

interface UseWatchlistParamsPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  params?: Record<string, unknown> | null
}

export function useWatchlistParamsPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  params,
}: UseWatchlistParamsPersistenceOptions) {
  useEffect(() => {
    if (!onWidgetParamsChange) return

    const handleParamsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<WatchlistWidgetUpdateEventDetail>).detail
      if (!detail?.params || typeof detail.params !== 'object') return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange({
        ...currentParams,
        ...detail.params,
      })
    }

    window.addEventListener(
      WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT,
      handleParamsUpdate as EventListener
    )

    return () => {
      window.removeEventListener(
        WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT,
        handleParamsUpdate as EventListener
      )
    }
  }, [onWidgetParamsChange, panelId, widget?.key, params])
}

interface EmitWatchlistParamsOptions {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}

export function emitWatchlistParamsChange({
  params,
  panelId,
  widgetKey,
}: EmitWatchlistParamsOptions) {
  if (!params || Object.keys(params).length === 0) return

  window.dispatchEvent(
    new CustomEvent<WatchlistWidgetUpdateEventDetail>(WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT, {
      detail: {
        params,
        panelId,
        widgetKey,
      },
    })
  )
}
