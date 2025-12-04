import { useEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowConsoleApp from './components/workflow-console-app'
import {
  WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
  type WorkflowWidgetSelectEventDetail,
} from '@/widgets/events'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { WorkflowDropdown } from '@/widgets/widgets/shared/components/workflow-dropdown'

const WorkflowConsoleWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  useEffect(() => {
    if (!onWidgetParamsChange || pairColor !== 'gray') {
      return
    }

    const handleWorkflowSelect = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowWidgetSelectEventDetail>).detail
      if (!detail?.workflowId) {
        return
      }
      if (panelId && detail.panelId && detail.panelId !== panelId) {
        return
      }
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) {
        return
      }

      const currentParams =
        widget?.params && typeof widget.params === 'object'
          ? (widget.params as Record<string, unknown>)
          : {}
      onWidgetParamsChange({ ...currentParams, workflowId: detail.workflowId })
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
  }, [onWidgetParamsChange, panelId, pairColor, widget?.key, widget?.params])

  const workspaceId = context?.workspaceId
  const {
    channelId,
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading,
    workflowIds,
    activeWorkflowIdForChannel,
  } = useWorkflowWidgetState({
    workspaceId,
    pairColor,
    widget,
    panelId,
    params,
    onWidgetParamsChange,
    fallbackWidgetKey: 'workflow-console',
    loggerScope: 'workflow console widget',
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(0)
  const fallbackPanelWidth = typeof window !== 'undefined' ? window.innerWidth : 1200

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setPanelWidth(containerRef.current.clientWidth)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to load workflows.' />
  }

  if (loadError) {
    return <WidgetStateMessage message={loadError} />
  }

  if (!hasLoadedWorkflows || isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))]'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (workflowIds.length === 0) {
    return <WidgetStateMessage message='No workflows available in this workspace.' />
  }

  if (!resolvedWorkflowId) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))]'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className='flex h-full w-full overflow-hidden bg-[hsl(var(--workflow-background))] px-3 py-2'
    >
      <WorkflowConsoleApp
        workspaceId={workspaceId}
        workflowId={resolvedWorkflowId}
        panelWidth={panelWidth || fallbackPanelWidth}
        channelId={channelId}
      />
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))] px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

type WorkflowConsoleHeaderSelectorProps = {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

const WorkflowConsoleHeaderSelector = ({
  workspaceId,
  widget,
  panelId,
}: WorkflowConsoleHeaderSelectorProps) => {
  const { resolvedPairColor, resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    panelId,
    params: widget?.params ?? null,
    fallbackWidgetKey: 'workflow-console',
    loggerScope: 'workflow console header',
    activateWorkflow: false,
  })

  const handleWorkflowChange = (workflowId: string) => {
    if (resolvedPairColor !== 'gray') {
      return
    }

    window.dispatchEvent(
      new CustomEvent<WorkflowWidgetSelectEventDetail>(WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT, {
        detail: {
          panelId,
          widgetKey: widget?.key,
          workflowId,
        },
      })
    )
  }

  return (
    <WorkflowDropdown
      workspaceId={workspaceId}
      pairColor={resolvedPairColor}
      value={resolvedWorkflowId}
      onChange={handleWorkflowChange}
    />
  )
}

export const workflowConsoleWidget: DashboardWidgetDefinition = {
  key: 'workflow_console',
  title: 'Workflow Console',
  icon: Activity,
  category: 'utility',
  description: 'Live workflow execution console with logs and streaming output.',
  component: (props) => <WorkflowConsoleWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    return {
      left: <span className='font-medium text-accent-foreground text-xs'>Console</span>,
      center: (
        <WorkflowConsoleHeaderSelector
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
      ),
    }
  },
}
