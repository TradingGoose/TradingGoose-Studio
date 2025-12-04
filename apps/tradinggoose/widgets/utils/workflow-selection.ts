import { useEffect } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'
import {
  WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
  type WorkflowWidgetSelectEventDetail,
} from '@/widgets/events'

interface UseWorkflowSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  pairColor?: PairColor
  params?: Record<string, unknown> | null
}

export function useWorkflowSelectionPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  pairColor = 'gray',
  params,
}: UseWorkflowSelectionPersistenceOptions) {
  useEffect(() => {
    if (!onWidgetParamsChange || pairColor !== 'gray') {
      return
    }

    const handleWorkflowSelect = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowWidgetSelectEventDetail>).detail
      if (!detail?.workflowId) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange({
        ...currentParams,
        workflowId: detail.workflowId,
      })
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
  }, [onWidgetParamsChange, panelId, pairColor, params, widget?.key])
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
