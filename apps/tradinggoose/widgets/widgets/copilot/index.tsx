import { useCallback, useEffect, useRef, useState } from 'react'
import { BotMessageSquare } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { CopilotHeader, CopilotHeaderActions } from './components/copilot/copilot-header'
import CopilotApp from './components/copilot-app'

const COPILOT_WIDGET_KEY = 'workflow-copilot'

const CopilotWidgetBody = ({
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
  } = useWorkflowWidgetState({
    workspaceId,
    pairColor,
    widget,
    panelId,
    params,
    onWidgetParamsChange,
    fallbackWidgetKey: COPILOT_WIDGET_KEY,
    loggerScope: 'workflow copilot widget',
    activateWorkflow: true,
    usePairWorkflowContext: false,
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(0)
  const fallbackPanelWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
  const chatIdFromParams =
    params && typeof params === 'object' && 'chatId' in params && params.chatId
      ? String(params.chatId)
      : null
  const normalizedPanelId = panelId && panelId.trim().length > 0 ? panelId : 'panel'
  const copilotChannelId =
    resolvedPairColor !== 'gray' ? `${channelId}-${normalizedPanelId}` : channelId

  const handleChatIdChange = useCallback(
    (nextChatId: string | null) => {
      if (!onWidgetParamsChange) return

      const normalizedCurrentId = chatIdFromParams ?? null
      const normalizedNextId = nextChatId ?? null
      if (normalizedCurrentId === normalizedNextId) return

      const baseParams = (params ?? {}) as Record<string, unknown>
      const { chatId: _chatId, ...nextParams } = baseParams
      if (normalizedNextId) {
        nextParams.chatId = normalizedNextId
      }

      if (resolvedWorkflowId) {
        nextParams.workflowId = resolvedWorkflowId
      }

      const hasKeys = Object.keys(nextParams).length > 0
      onWidgetParamsChange(hasKeys ? nextParams : null)
    },
    [chatIdFromParams, onWidgetParamsChange, params, resolvedWorkflowId]
  )

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
    <div ref={containerRef} className='flex h-full w-full overflow-hidden p-2'>
      <CopilotApp
        workspaceId={workspaceId}
        workflowId={resolvedWorkflowId}
        panelWidth={panelWidth || fallbackPanelWidth}
        channelId={channelId}
        copilotChannelId={copilotChannelId}
        chatId={chatIdFromParams}
        pairColor={resolvedPairColor}
        onChatChange={handleChatIdChange}
      />
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

export const copilotWidget: DashboardWidgetDefinition = {
  key: 'copilot',
  title: 'Copilot',
  icon: BotMessageSquare,
  category: 'utility',
  description: 'AI copilot experience across workflows and workspace tools.',
  component: (props) => <CopilotWidgetBody {...props} />,
  renderHeader: ({ widget, panelId }) => {
    const { channelId, resolvedPairColor } = resolveWidgetChannel({
      pairColor: widget?.pairColor ?? 'gray',
      widget,
      panelId,
      fallbackWidgetKey: COPILOT_WIDGET_KEY,
    })
    const normalizedPanelId = panelId && panelId.trim().length > 0 ? panelId : 'panel'
    const copilotChannelId =
      resolvedPairColor !== 'gray' ? `${channelId}-${normalizedPanelId}` : channelId

    return {
      left: <CopilotHeader channelId={copilotChannelId} />,
      right: <CopilotHeaderActions channelId={copilotChannelId} />,
    }
  },
}
