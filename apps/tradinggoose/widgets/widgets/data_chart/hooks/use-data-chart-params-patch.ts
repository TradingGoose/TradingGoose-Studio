'use client'

import { useCallback } from 'react'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'

export const useDataChartParamsPatch = () => {
  const { patchWidgetParams } = useWidgetConfigRuntimeActions()
  return useCallback(
    (params: Record<string, unknown>) => patchWidgetParams(params),
    [patchWidgetParams]
  )
}
