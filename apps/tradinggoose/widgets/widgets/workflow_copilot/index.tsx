import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowCopilotApp from './components/workflow-copilot-app'
import { useWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import { WorkflowDropdown } from '@/widgets/widgets/shared/components/workflow-dropdown'
import {
  emitWorkflowSelectionChange,
  useWorkflowSelectionPersistence,
} from '@/widgets/utils/workflow-selection'
import { CopilotHeader, CopilotHeaderActions } from './components/copilot/copilot-header'

const WorkflowCopilotWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const { workspaceId, channelId, resolvedPairColor, isLinkedToColorPair } = useWidgetChannel({
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
  const chatIdFromParams =
    params && typeof params === 'object' && 'chatId' in params && params.chatId
      ? String(params.chatId)
      : null
  const copilotChannelId =
    resolvedPairColor !== 'gray'
      ? `${channelId}-${panelId && panelId.trim().length > 0 ? panelId : 'panel'}`
      : channelId

  const handleChatIdChange = useCallback(
    (nextChatId: string | null) => {
      if (!onWidgetParamsChange) return

      const normalizedCurrentId = chatIdFromParams ?? null
      const normalizedNextId = nextChatId ?? null
      if (normalizedCurrentId === normalizedNextId) return

      const nextParams = { ...(params ?? {}) }
      if (normalizedNextId) {
        nextParams.chatId = normalizedNextId
      } else {
        delete nextParams.chatId
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
      className='flex h-full w-full overflow-hidden bg-[hsl(var(--workflow-background))] p-2'
    >
      <WorkflowCopilotApp
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
  <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))] px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

type WorkflowCopilotHeaderSelectorProps = {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

const WorkflowCopilotHeaderSelector = ({
  workspaceId,
  widget,
  panelId,
}: WorkflowCopilotHeaderSelectorProps) => {
  const { resolvedPairColor, resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    panelId,
    params: widget?.params ?? null,
    fallbackWidgetKey: 'workflow-copilot',
    loggerScope: 'workflow copilot header',
    activateWorkflow: false,
  })

  const handleWorkflowChange = useCallback(
    (workflowId: string) => {
      if (resolvedPairColor !== 'gray') {
        return
      }

      emitWorkflowSelectionChange({
        panelId,
        widgetKey: widget?.key ?? undefined,
        workflowId,
      })
    },
    [panelId, resolvedPairColor, widget?.key]
  )

  return (
    <WorkflowDropdown
      workspaceId={workspaceId}
      pairColor={resolvedPairColor}
      value={resolvedWorkflowId}
      onChange={handleWorkflowChange}
      triggerClassName='w-auto min-w-[240px]'
    />
  )
}

export const workflowCopilotWidget: DashboardWidgetDefinition = {
  key: 'workflow_copilot',
  title: 'Workflow Copilot',
  icon: Sparkles,
  category: 'utility',
  description: 'AI copilot experience tailored to the selected workflow.',
  component: (props) => <WorkflowCopilotWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const { channelId, resolvedPairColor } = resolveWidgetChannel({
      pairColor: widget?.pairColor ?? 'gray',
      widget,
      panelId,
      fallbackWidgetKey: 'workflow-copilot',
    })
    const normalizedPanelId = panelId && panelId.trim().length > 0 ? panelId : 'panel'
    const copilotChannelId =
      resolvedPairColor !== 'gray' ? `${channelId}-${normalizedPanelId}` : channelId

    return {
      left: <CopilotHeader channelId={copilotChannelId} />,
      center: (
        <WorkflowCopilotHeaderSelector
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
      ),
      right: <CopilotHeaderActions channelId={copilotChannelId} />,
    }
  },
}
