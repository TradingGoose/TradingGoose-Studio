'use client'

import { useMemo } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { widgetHeaderControlClassName } from '@/components/widget-header-control'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useWorkflowEditorCopy } from '@/widgets/widgets/editor_workflow/copy'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WidgetInstance } from '@/widgets/layout'
import { isPairColor, type PairColor } from '@/widgets/pair-colors'
import { ControlBar } from '@/widgets/widgets/editor_workflow/components/control-bar/control-bar'

const FALLBACK_TEXT_CLASS = widgetHeaderControlClassName('text-muted-foreground/80')

export const readWorkflowWidgetChannelId = (
  pairColor: PairColor,
  widgetKey: string,
  panelId?: string
) => {
  if (pairColor !== 'gray') {
    return `pair-${pairColor}`
  }
  return `${widgetKey}-${panelId ?? 'panel'}`
}

interface WorkflowWidgetControlBarProps {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

export function WorkflowWidgetControlBar({
  workspaceId,
  widget,
  panelId,
}: WorkflowWidgetControlBarProps) {
  const copy = useWorkflowEditorCopy()
  if (!workspaceId) {
    return <span className={FALLBACK_TEXT_CLASS}>{copy.controlsUnavailable}</span>
  }

  const resolvedPairColor = isPairColor(widget?.pairColor) ? widget?.pairColor : 'gray'
  const widgetKey = widget?.key ?? 'workflow-editor'
  const channelId = useMemo(
    () => readWorkflowWidgetChannelId(resolvedPairColor, widgetKey, panelId),
    [resolvedPairColor, widgetKey, panelId]
  )

  const activeWorkflowId = useWorkflowRegistry((state) => state.getActiveWorkflowId(channelId))

  if (!activeWorkflowId) {
    return <span className={FALLBACK_TEXT_CLASS}>{copy.controlsUnavailable}</span>
  }

  return (
    <TooltipProvider delayDuration={100}>
      <WorkflowSessionProvider workspaceId={workspaceId} workflowId={activeWorkflowId}>
        <WorkflowRouteProvider
          workspaceId={workspaceId}
          workflowId={activeWorkflowId}
          channelId={channelId}
        >
          <ControlBar variant='widget' className='inline-flex items-center gap-1 whitespace-nowrap' />
        </WorkflowRouteProvider>
      </WorkflowSessionProvider>
    </TooltipProvider>
  )
}
