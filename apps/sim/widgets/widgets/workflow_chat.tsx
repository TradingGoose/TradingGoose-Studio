import { useEffect, useMemo, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { shallow } from 'zustand/shallow'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry, hasWorkflowsInitiallyLoaded } from '@/stores/workflows/registry/store'
import WorkflowChatApp from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-chat-app'

const ChatWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const widgetKey = widget?.key ?? 'workflow-chat'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const { workflows, isLoading, loadWorkflows, setActiveWorkflow } = useWorkflowRegistry(
    (state) => ({
      workflows: state.workflows,
      isLoading: state.isLoading,
      loadWorkflows: state.loadWorkflows,
      setActiveWorkflow: state.setActiveWorkflow,
    }),
    shallow
  )
  const [hasLoadedWorkflows, setHasLoadedWorkflows] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const requestedWorkflowId =
    resolvedPairColor === 'gray' && typeof params === 'object' && params && 'workflowId' in params
      ? String(params.workflowId)
      : null

  const channelId = useMemo(() => {
    if (resolvedPairColor !== 'gray') {
      return `pair-${resolvedPairColor}`
    }
    return `${widgetKey}-${panelId ?? 'panel'}`
  }, [resolvedPairColor, widgetKey, panelId])

  const activeWorkflowIdForChannel = useWorkflowRegistry((state) =>
    typeof state.getActiveWorkflowId === 'function'
      ? state.getActiveWorkflowId(channelId)
      : state.activeWorkflowId
  )

  const workspaceHasWorkflows = useMemo(() => {
    if (!workspaceId) {
      return false
    }
    return Object.values(workflows ?? {}).some((workflow) => workflow?.workspaceId === workspaceId)
  }, [workflows, workspaceId])

  useEffect(() => {
    setLoadError(null)

    if (!workspaceId) {
      setHasLoadedWorkflows(true)
      return
    }

    if (workspaceHasWorkflows || hasWorkflowsInitiallyLoaded()) {
      setHasLoadedWorkflows(true)
      return
    }

    let cancelled = false
    setHasLoadedWorkflows(false)

    loadWorkflows(workspaceId)
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load workflows for chat widget', error)
          setLoadError('Unable to load workflows')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHasLoadedWorkflows(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, workspaceHasWorkflows, loadWorkflows])

  const workflowIds = useMemo(() => Object.keys(workflows ?? {}), [workflows])

  const resolvedWorkflowId = useMemo(() => {
    if (!hasLoadedWorkflows || workflowIds.length === 0) {
      return null
    }

    const pairWorkflowId =
      resolvedPairColor !== 'gray' && pairContext.workflowId && workflows[pairContext.workflowId]
        ? pairContext.workflowId
        : null

    if (pairWorkflowId) {
      return pairWorkflowId
    }

    if (requestedWorkflowId && workflows[requestedWorkflowId]) {
      return requestedWorkflowId
    }

    return workflowIds[0]
  }, [hasLoadedWorkflows, workflowIds, pairContext.workflowId, workflows, requestedWorkflowId, resolvedPairColor])

  useEffect(() => {
    if (!resolvedWorkflowId || activeWorkflowIdForChannel === resolvedWorkflowId) {
      return
    }

    let cancelled = false

    setActiveWorkflow({ workflowId: resolvedWorkflowId, channelId })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to activate workflow inside chat widget', error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [resolvedWorkflowId, activeWorkflowIdForChannel, setActiveWorkflow, channelId])

  const currentPairWorkflowId = pairContext.workflowId
  const currentTicker = pairContext.ticker

  useEffect(() => {
    if (resolvedPairColor === 'gray' || !resolvedWorkflowId) {
      return
    }

    if (currentPairWorkflowId === resolvedWorkflowId) {
      return
    }

    setPairContext(resolvedPairColor as any, {
      workflowId: resolvedWorkflowId,
      ticker: currentTicker,
      channelId,
    })
  }, [
    resolvedPairColor,
    resolvedWorkflowId,
    currentPairWorkflowId,
    currentTicker,
    setPairContext,
    channelId,
  ])

  useEffect(() => {
    if (resolvedPairColor !== 'gray') {
      return
    }

    if (!resolvedWorkflowId || !onWidgetParamsChange) {
      return
    }

    if (requestedWorkflowId === resolvedWorkflowId) {
      return
    }

    onWidgetParamsChange({ workflowId: resolvedWorkflowId })
  }, [resolvedPairColor, resolvedWorkflowId, requestedWorkflowId, onWidgetParamsChange])

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
