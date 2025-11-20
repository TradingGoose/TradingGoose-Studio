'use client'

import { useMemo } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ControlBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/control-bar'
import { WorkflowRouteProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-route-context'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { widgetHeaderControlClassName } from '@/widgets/components/widget-header-control'
import { isPairColor, type PairColor } from '@/widgets/pair-colors'
import type { WidgetInstance } from '@/widgets/layout'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WorkflowStoreProvider } from '@/stores/workflows/workflow/store-client'

const FALLBACK_TEXT_CLASS = widgetHeaderControlClassName('text-muted-foreground/80')

export const getWorkflowWidgetChannelId = (pairColor: PairColor, widgetKey: string, panelId?: string) => {
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

export function WorkflowWidgetControlBar({ workspaceId, widget, panelId }: WorkflowWidgetControlBarProps) {
  if (!workspaceId) {
    return <span className={FALLBACK_TEXT_CLASS}>Controls unavailable</span>
  }

  const resolvedPairColor = isPairColor(widget?.pairColor) ? widget?.pairColor : 'gray'
  const widgetKey = widget?.key ?? 'workflow-editor'
  const channelId = useMemo(
    () => getWorkflowWidgetChannelId(resolvedPairColor, widgetKey, panelId),
    [resolvedPairColor, widgetKey, panelId]
  )

  const activeWorkflowId = useWorkflowRegistry((state) =>
    typeof state.getActiveWorkflowId === 'function'
      ? state.getActiveWorkflowId(channelId)
      : state.activeWorkflowId
  )

  if (!activeWorkflowId) {
    return <span className={FALLBACK_TEXT_CLASS}>Controls unavailable</span>
  }

  return (
    <TooltipProvider delayDuration={100}>
      <WorkspacePermissionsProvider workspaceId={workspaceId}>
        <WorkflowRouteProvider workspaceId={workspaceId} workflowId={activeWorkflowId} channelId={channelId}>
          <WorkflowStoreProvider channelId={channelId}>
            <ControlBar
              variant='widget'
              className='inline-flex items-center gap-1 whitespace-nowrap'
            />
          </WorkflowStoreProvider>
        </WorkflowRouteProvider>
      </WorkspacePermissionsProvider>
    </TooltipProvider>
  )
}
