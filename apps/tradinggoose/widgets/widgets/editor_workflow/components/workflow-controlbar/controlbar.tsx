'use client'

import { TooltipProvider } from '@/components/ui/tooltip'
import { widgetHeaderControlClassName } from '@/components/widget-header-control'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { WidgetInstance } from '@/widgets/layout'
import { ControlBar } from '@/widgets/widgets/editor_workflow/components/control-bar/control-bar'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useWorkflowEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

const FALLBACK_TEXT_CLASS = widgetHeaderControlClassName('text-muted-foreground/80')

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
  const { channelId, resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    panelId,
    params: widget?.params ?? null,
    fallbackWidgetKey: 'editor_workflow',
    loggerScope: 'workflow editor control bar',
    activateWorkflow: false,
  })

  if (!workspaceId || !resolvedWorkflowId) {
    return <span className={FALLBACK_TEXT_CLASS}>{copy.controlsUnavailable}</span>
  }

  return (
    <TooltipProvider delayDuration={100}>
      <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
        <WorkflowSessionProvider workspaceId={workspaceId} workflowId={resolvedWorkflowId}>
          <WorkflowRouteProvider
            workspaceId={workspaceId}
            workflowId={resolvedWorkflowId}
            channelId={channelId}
          >
            <ControlBar
              variant='widget'
              className='inline-flex items-center gap-1 whitespace-nowrap'
            />
          </WorkflowRouteProvider>
        </WorkflowSessionProvider>
      </WorkspacePermissionsProvider>
    </TooltipProvider>
  )
}
