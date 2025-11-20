import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowCopilotApp from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-copilot-app'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import { useWidgetChannel } from '@/widgets/hooks/use-widget-channel'

const WorkflowCopilotWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const { workspaceId, channelId, isLinkedToColorPair } = useWidgetChannel({
    context,
    pairColor,
    widget,
    panelId,
    fallbackWidgetKey: 'workflow-copilot',
  })
  const {
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
    fallbackWidgetKey: 'workflow-copilot',
    loggerScope: 'workflow copilot widget',
    activateWorkflow: isLinkedToColorPair,
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

  if (
    !hasLoadedWorkflows ||
    isLoading ||
    !resolvedWorkflowId ||
    activeWorkflowIdForChannel !== resolvedWorkflowId
  ) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))]'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (workflowIds.length === 0) {
    return <WidgetStateMessage message='No workflows available in this workspace.' />
  }

  return (
    <div ref={containerRef} className='flex h-full w-full overflow-hidden bg-[hsl(var(--workflow-background))] p-2'>
      <WorkflowCopilotApp
        workspaceId={workspaceId}
        workflowId={resolvedWorkflowId}
        panelWidth={panelWidth || fallbackPanelWidth}
        channelId={channelId}
      />
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))] px-4 text-center text-xs text-muted-foreground'>
    {message}
  </div>
)

export const workflowCopilotWidget: DashboardWidgetDefinition = {
  key: 'workflow_copilot',
  title: 'Workflow Copilot',
  icon: Sparkles,
  category: 'utility',
  description: 'AI copilot experience tailored to the selected workflow.',
  component: (props) => <WorkflowCopilotWidgetBody {...props} />,
  renderHeader: () => ({
    left: <span className='text-xs font-medium text-accent-foreground'>Copilot</span>,
    center: <span className='text-xs text-muted-foreground'>Workflow assistance</span>,
  }),
}
