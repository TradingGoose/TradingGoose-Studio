import { useEffect } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import {
  DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT,
  type DataChartWidgetUpdateEventDetail,
} from '@/widgets/events'

interface UseDataChartParamsPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  params?: Record<string, unknown> | null
}

export function useDataChartParamsPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  params,
}: UseDataChartParamsPersistenceOptions) {
  useEffect(() => {
    if (!onWidgetParamsChange) {
      return
    }

    const handleParamsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<DataChartWidgetUpdateEventDetail>).detail
      if (!detail?.params) return
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
      DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT,
      handleParamsUpdate as EventListener
    )

    return () => {
      window.removeEventListener(
        DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT,
        handleParamsUpdate as EventListener
      )
    }
  }, [onWidgetParamsChange, panelId, params, widget?.key])
}

interface EmitDataChartParamsOptions {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}

export function emitDataChartParamsChange({
  params,
  panelId,
  widgetKey,
}: EmitDataChartParamsOptions) {
  if (!params || Object.keys(params).length === 0) return

  window.dispatchEvent(
    new CustomEvent<DataChartWidgetUpdateEventDetail>(DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT, {
      detail: {
        params,
        panelId,
        widgetKey,
      },
    })
  )
}
