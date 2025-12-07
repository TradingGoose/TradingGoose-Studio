import { useEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowConsoleApp from './components/workflow-console-app'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { WorkflowDropdown } from '@/widgets/widgets/shared/components/workflow-dropdown'
import {
  emitWorkflowSelectionChange,
  useWorkflowSelectionPersistence,
} from '@/widgets/utils/workflow-selection'

const WorkflowConsoleWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId
  const {
    channelId,
    resolvedPairColor,
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
  useWorkflowSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    pairColor: resolvedPairColor,
    params,
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
      <div className='flex h-full w-full items-center justify-center '>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (workflowIds.length === 0) {
    return <WidgetStateMessage message='No workflows available in this workspace.' />
  }

  if (!resolvedWorkflowId) {
    return (
      <div className='flex h-full w-full items-center justify-center '>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className='flex h-full w-full overflow-hidden  px-3 py-2'
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
  <div className='flex h-full w-full items-center justify-center  px-4 text-center text-muted-foreground text-xs'>
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

    emitWorkflowSelectionChange({
      panelId,
      widgetKey: widget?.key ?? undefined,
      workflowId,
    })
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
