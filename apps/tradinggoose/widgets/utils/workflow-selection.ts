import { useEffect, useRef } from 'react'
import { isEqual } from 'lodash'
import {
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'
import {
  WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
  WORKFLOW_WIDGET_UPDATE_PARAMS_EVENT,
  type WorkflowWidgetSelectEventDetail,
  type WorkflowWidgetUpdateEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'

interface UseWorkflowSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  pairColor?: PairColor
  params?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const sanitizeWorkflowWidgetParams = (
  params: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!params || !isRecord(params)) return null

  const nextParams: Record<string, unknown> = {}
  const workflowId = normalizeString(params.workflowId)
  const marketProvider = normalizeString(params.marketProvider)
  const marketProviderParams = sanitizeMarketProviderParamsForWidget(
    marketProvider,
    params.marketProviderParams
  )
  const marketAuth = sanitizeMarketProviderAuth(params.marketAuth)

  if (workflowId) nextParams.workflowId = workflowId
  if (marketProvider) nextParams.marketProvider = marketProvider
  if (marketProviderParams) nextParams.marketProviderParams = marketProviderParams
  if (marketAuth) nextParams.marketAuth = marketAuth

  return Object.keys(nextParams).length > 0 ? nextParams : null
}

export function useWorkflowSelectionPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  pairColor = 'gray',
  params,
}: UseWorkflowSelectionPersistenceOptions) {
  const latestParamsRef = useRef<Record<string, unknown> | null>(
    sanitizeWorkflowWidgetParams(params)
  )

  useEffect(() => {
    latestParamsRef.current = sanitizeWorkflowWidgetParams(params)
  }, [params])

  useEffect(() => {
    if (!onWidgetParamsChange) {
      return
    }

    const handleWorkflowSelect = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowWidgetSelectEventDetail>).detail
      if (!detail?.workflowId) return
      if (pairColor !== 'gray') return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams = latestParamsRef.current ?? {}
      const nextParams = sanitizeWorkflowWidgetParams({
        ...currentParams,
        workflowId: detail.workflowId,
      })

      if (isEqual(currentParams, nextParams)) return
      latestParamsRef.current = nextParams
      onWidgetParamsChange(nextParams)
    }

    const handleParamsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowWidgetUpdateEventDetail>).detail
      if (!detail?.params || !isRecord(detail.params)) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams = latestParamsRef.current ?? {}
      const nextParams = sanitizeWorkflowWidgetParams({
        ...currentParams,
        ...detail.params,
      })

      if (isEqual(currentParams, nextParams)) return
      latestParamsRef.current = nextParams
      onWidgetParamsChange(nextParams)
    }

    window.addEventListener(
      WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
      handleWorkflowSelect as EventListener
    )
    window.addEventListener(WORKFLOW_WIDGET_UPDATE_PARAMS_EVENT, handleParamsUpdate)

    return () => {
      window.removeEventListener(
        WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
        handleWorkflowSelect as EventListener
      )
      window.removeEventListener(WORKFLOW_WIDGET_UPDATE_PARAMS_EVENT, handleParamsUpdate)
    }
  }, [onWidgetParamsChange, panelId, pairColor, widget?.key])
}

interface EmitWorkflowSelectionOptions {
  workflowId: string
  panelId?: string
  widgetKey?: string
}

export function emitWorkflowSelectionChange({
  workflowId,
  panelId,
  widgetKey,
}: EmitWorkflowSelectionOptions) {
  if (!workflowId) return

  window.dispatchEvent(
    new CustomEvent<WorkflowWidgetSelectEventDetail>(WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT, {
      detail: {
        workflowId,
        panelId,
        widgetKey,
      },
    })
  )
}

export function emitWorkflowParamsChange({
  params,
  panelId,
  widgetKey,
}: {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}) {
  if (!params || Object.keys(params).length === 0) return

  window.dispatchEvent(
    new CustomEvent<WorkflowWidgetUpdateEventDetail>(WORKFLOW_WIDGET_UPDATE_PARAMS_EVENT, {
      detail: {
        params,
        panelId,
        widgetKey,
      },
    })
  )
}
