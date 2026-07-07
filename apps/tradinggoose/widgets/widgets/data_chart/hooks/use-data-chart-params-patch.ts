'use client'

import { useMemo } from 'react'
import { useWidgetConfigRuntimeActionsOptional } from '@/widgets/widget-config-runtime'

/**
 * Canonical persistence path for data-chart widget params: routes PATCH-mode
 * mutations through the widget config runtime (plan/applyWidgetConfigMutation).
 *
 * Safe outside `WidgetConfigRuntimeProvider` (e.g. copy tests): persistence
 * becomes a no-op instead of throwing.
 */
export const useDataChartParamsPatch = (panelId?: string, widgetKey?: string) => {
  const actions = useWidgetConfigRuntimeActionsOptional()
  const resolvedWidgetKey = widgetKey ?? 'data_chart'

  return useMemo(
    () => (params: Record<string, unknown>) => {
      if (!actions || !panelId) return
      actions.patchWidgetParams(panelId, resolvedWidgetKey, params)
    },
    [actions, panelId, resolvedWidgetKey]
  )
}
