import { MessageCircle } from 'lucide-react'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowChatApp from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-chat-app'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'

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
    <div className='flex h-full w-full overflow-hidden bg-[hsl(var(--workflow-background))]'>
      <WorkflowChatApp workspaceId={workspaceId} workflowId={resolvedWorkflowId} channelId={channelId} />
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))] px-4 text-center text-xs text-muted-foreground'>
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
      widget && widget.params && typeof widget.params === 'object' && 'workflowId' in widget.params
        ? (widget.params.workflowId as string)
        : 'default'

    return {
      left: <span className='text-xs font-medium text-accent-foreground'>Chat</span>,
      center: <span className='text-xs text-muted-foreground'>Idle</span>,
      right: (
        <button className='rounded-md border border-border px-2 py-1 text-xs font-medium text-accent-foreground hover:bg-card/20'>
          New chat
        </button>
      ),
    }
  },
}
