'use client'

import { useCallback, useMemo } from 'react'
import { Ban, MessageCircle } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
} from '@/components/widget-header-control'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { useWorkflowChatMessages, useWorkflowDropdownMessages } from '@/i18n/workspace-widget-hooks'
import { useChatStore } from '@/stores/chat/store'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { WorkflowDropdown } from '@/widgets/widgets/components/workflow-dropdown'
import { workflowChatWidgetContract } from '@/widgets/widgets/workflow_chat/contract'
import { OutputSelect } from './components'
import WorkflowChatApp, { WorkflowChatSessionProviders } from './components/workflow-chat-app'

const ChatWidgetBody = ({ params, context, pairColor = 'gray', widget }: WidgetComponentProps) => {
  const copy = useWorkflowChatMessages()
  const dropdownCopy = useWorkflowDropdownMessages()
  const workspaceId = context?.workspaceId
  const { resolvedWorkflowId, hasLoadedWorkflows, loadError, isLoading, workflowIds } =
    useWorkflowWidgetState({
      workspaceId,
      pairColor,
      widget,
      params,
    })

  if (!workspaceId) {
    return <WidgetStateMessage message={copy.selectWorkspace} />
  }

  if (loadError) {
    return <WidgetStateMessage message={copy[loadError]} />
  }

  if (!hasLoadedWorkflows || isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-background'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (workflowIds.length === 0) {
    return <WidgetStateMessage message={copy.noWorkflows} />
  }

  if (!resolvedWorkflowId) {
    return <WidgetStateMessage message={dropdownCopy.selectWorkflow} />
  }

  return (
    <div className='flex h-full w-full overflow-hidden bg-background'>
      <WorkflowChatApp
        workspaceId={workspaceId}
        workflowId={resolvedWorkflowId}
        accessMode={context?.canWrite === false ? 'read' : 'write'}
      />
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center bg-background px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

function ChatOutputsHeader({
  workspaceId,
  widget,
  triggerClassName,
  accessMode,
}: {
  workspaceId?: string
  widget?: WidgetInstance | null
  triggerClassName?: string
  accessMode: ReviewAccessMode
}) {
  const copy = useWorkflowChatMessages()
  const { selectedWorkflowOutputs, setSelectedWorkflowOutput } = useChatStore()
  const { resolvedWorkflowId: workflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    params: widget?.params ?? null,
  })

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

  const outputSelect = (
    <OutputSelect
      workflowId={workflowId}
      selectedOutputs={selectedOutputs}
      onOutputSelect={handleSelect}
      disabled={!workflowId}
      placeholder={copy.selectOutputs}
      triggerClassName={triggerClassName}
    />
  )

  return (
    <div className='flex min-w-0 items-center gap-2'>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='min-w-[220px]'>
            {workspaceId && workflowId ? (
              <WorkflowChatSessionProviders
                workspaceId={workspaceId}
                workflowId={workflowId}
                accessMode={accessMode}
              >
                {outputSelect}
              </WorkflowChatSessionProviders>
            ) : (
              outputSelect
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side='top'>{copy.selectWorkflowOutputs}</TooltipContent>
      </Tooltip>
    </div>
  )
}

type ChatWorkflowHeaderSelectorProps = {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

const ChatWorkflowHeaderSelector = ({
  workspaceId,
  widget,
  panelId,
}: ChatWorkflowHeaderSelectorProps) => {
  const { resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    params: widget?.params ?? null,
  })
  const actions = useWidgetConfigRuntimeActions()
  const patchLinkedParams =
    (widget?.pairColor ?? 'gray') === 'gray'
      ? actions.patchWidgetParams
      : actions.patchWidgetColorPair
  const handleWorkflowChange = useCallback(
    (workflowId: string) => {
      patchLinkedParams({ workflowId })
    },
    [patchLinkedParams]
  )

  return (
    <WorkflowDropdown
      workspaceId={workspaceId}
      value={resolvedWorkflowId}
      onChange={handleWorkflowChange}
      triggerClassName='w-auto min-w-[240px]'
    />
  )
}

function ClearChatButton({
  workspaceId,
  widget,
  panelId,
}: {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}) {
  const copy = useWorkflowChatMessages()
  const { resolvedWorkflowId: workflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    params: widget?.params ?? null,
  })
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
            aria-label={copy.clearChat}
            disabled={isDisabled}
          >
            <Ban className='h-3.5 w-3.5' />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side='top'>{copy.clearChat}</TooltipContent>
    </Tooltip>
  )
}

export const chatWidget: DashboardWidgetDefinition = {
  contract: workflowChatWidgetContract,
  icon: MessageCircle,
  component: (props) => <ChatWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    return {
      left: (
        <div className={widgetHeaderButtonGroupClassName()}>
          <ChatOutputsHeader
            workspaceId={context?.workspaceId}
            widget={widget}
            accessMode={context?.canWrite === false ? 'read' : 'write'}
            triggerClassName={widgetHeaderControlClassName('flex items-center gap-1 min-w-[240px]')}
          />
        </div>
      ),
      center: (
        <ChatWorkflowHeaderSelector
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
      ),
      right: (
        <ClearChatButton workspaceId={context?.workspaceId} widget={widget} panelId={panelId} />
      ),
    }
  },
}
