import { useEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowConsoleApp from './components/workflow-console-app'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'

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

export const workflowConsoleWidget: DashboardWidgetDefinition = {
  key: 'workflow_console',
  title: 'Workflow Console',
  icon: Activity,
  category: 'utility',
  description: 'Live workflow execution console with logs and streaming output.',
  component: (props) => <WorkflowConsoleWidgetBody {...props} />,
  renderHeader: ({ widget }) => {
    const workflowId =
      widget?.params && typeof widget.params === 'object' && 'workflowId' in widget.params
        ? (widget.params.workflowId as string)
        : 'default'

    return {
      left: <span className='font-medium text-accent-foreground text-xs'>Console</span>,
      center: <span className='text-muted-foreground text-xs'>Workflow: {workflowId}</span>,
    }
  },
}
