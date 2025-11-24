import { MessageCircle } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowChatApp from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-chat-app'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'

const ChatWidgetBody = ({
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
    fallbackWidgetKey: 'workflow-chat',
    loggerScope: 'workflow chat widget',
  })
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
    <div className='flex h-full w-full overflow-hidden bg-[hsl(var(--workflow-background))]'>
      <WorkflowChatApp
        workspaceId={workspaceId}
        workflowId={resolvedWorkflowId}
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

export const chatWidget: DashboardWidgetDefinition = {
  key: 'workflow_chat',
  title: 'Workflow Chat',
  icon: MessageCircle,
  category: 'utility',
  description: 'Chat interface to interact with workflow blocks.',
  component: (props) => <ChatWidgetBody {...props} />,
  renderHeader: ({ widget }) => {
    const workflowId =
      widget?.params && typeof widget.params === 'object' && 'workflowId' in widget.params
        ? (widget.params.workflowId as string)
        : 'default'

    return {
      left: <span className='font-medium text-accent-foreground text-xs'>Chat</span>,
      center: <span className='text-muted-foreground text-xs'>Idle</span>,
      right: (
        <button className='rounded-md border border-border px-2 py-1 font-medium text-accent-foreground text-xs hover:bg-card/20'>
          New chat
        </button>
      ),
    }
  },
}
