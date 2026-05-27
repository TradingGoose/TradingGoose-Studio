import { useEffect, useRef } from 'react'
import { isEqual } from 'lodash'
import {
  WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
  type WorkflowWidgetSelectEventDetail,
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

  const { workflowId: rawWorkflowId, ...restParams } = params
  const workflowId = normalizeString(rawWorkflowId)
  const nextParams = workflowId ? { ...restParams, workflowId } : restParams

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

    window.addEventListener(
      WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
      handleWorkflowSelect as EventListener
    )

    return () => {
      window.removeEventListener(
        WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
        handleWorkflowSelect as EventListener
      )
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
