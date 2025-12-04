'use client'

import { useCallback, useMemo } from 'react'
import { Ban, MessageCircle } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChatStore } from '@/stores/panel/chat/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WorkflowStoreProvider } from '@/stores/workflows/workflow/store-client'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import {
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/shared/components/widget-header-control'
import { OutputSelect } from './components'
import WorkflowChatApp from './components/workflow-chat-app'

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

function useChannelWorkflowId(channelId: string, fallbackWorkflowId?: string | null) {
  return useWorkflowRegistry(
    useCallback(
      (state) => {
        try {
          return state.getActiveWorkflowId(channelId) ?? fallbackWorkflowId ?? null
        } catch {
          return fallbackWorkflowId ?? null
        }
      },
      [channelId, fallbackWorkflowId]
    )
  )
}

function ChatOutputsHeader({
  channelId,
  fallbackWorkflowId,
  triggerClassName,
}: {
  channelId: string
  fallbackWorkflowId?: string | null
  triggerClassName?: string
}) {
  const { selectedWorkflowOutputs, setSelectedWorkflowOutput } = useChatStore()
  const workflowId = useChannelWorkflowId(channelId, fallbackWorkflowId)

  const selectedOutputs = useMemo(() => {
    if (!workflowId) return []
    const selected = selectedWorkflowOutputs[workflowId]
    if (!selected || selected.length === 0) return []
    return [...new Set(selected)]
  }, [selectedWorkflowOutputs, workflowId])

  const handleSelect = useCallback(
    (values: string[]) => {
      if (!workflowId) return
      const deduped = [...new Set(values)]
      setSelectedWorkflowOutput(workflowId, deduped)
    },
    [setSelectedWorkflowOutput, workflowId]
  )

  return (
    <WorkflowStoreProvider channelId={channelId} workflowId={workflowId ?? undefined}>
      <div className='flex min-w-0 items-center gap-2'>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='min-w-[220px]'>
              <OutputSelect
                workflowId={workflowId}
                selectedOutputs={selectedOutputs}
                onOutputSelect={handleSelect}
                disabled={!workflowId}
                placeholder='Select outputs'
                triggerClassName={triggerClassName}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side='top'>Select workflow outputs</TooltipContent>
        </Tooltip>
      </div>
    </WorkflowStoreProvider>
  )
}

function ClearChatButton({
  channelId,
  fallbackWorkflowId,
}: {
  channelId: string
  fallbackWorkflowId?: string | null
}) {
  const workflowId = useChannelWorkflowId(channelId, fallbackWorkflowId)
  const clearChat = useChatStore((state) => state.clearChat)
  const hasMessages = useChatStore(
    useCallback(
      (state) =>
        !!(workflowId && state.messages.some((message) => message.workflowId === workflowId)),
      [workflowId]
    )
  )

  const handleClearChat = useCallback(() => {
    if (!workflowId) return
    clearChat(workflowId)
  }, [clearChat, workflowId])

  const isDisabled = !workflowId || !hasMessages

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='inline-flex'>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={handleClearChat}
            aria-label='Clear chat'
            disabled={isDisabled}
          >
            <Ban className='h-3.5 w-3.5' />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side='top'>Clear Chat</TooltipContent>
    </Tooltip>
  )
}

export const chatWidget: DashboardWidgetDefinition = {
  key: 'workflow_chat',
  title: 'Workflow Chat',
  icon: MessageCircle,
  category: 'utility',
  description: 'Chat interface to interact with workflow blocks.',
  component: (props) => <ChatWidgetBody {...props} />,
  renderHeader: ({ widget, panelId }) => {
    const { channelId, resolvedPairColor } = resolveWidgetChannel({
      pairColor: widget?.pairColor ?? 'gray',
      widget,
      panelId,
      fallbackWidgetKey: 'workflow-chat',
    })
    const workflowIdParam =
      widget?.params && typeof widget.params === 'object' && 'workflowId' in widget.params
        ? (widget.params.workflowId as string)
        : null

    return {
      center: (
        <div className='flex items-center gap-2'>
          <ChatOutputsHeader
            channelId={channelId}
            fallbackWorkflowId={workflowIdParam}
            triggerClassName={widgetHeaderControlClassName(
              'flex items-center gap-2 min-w-[240px]'
            )}
          />
        </div>
      ),
      right: <ClearChatButton channelId={channelId} fallbackWorkflowId={workflowIdParam} />,
    }
  },
}
