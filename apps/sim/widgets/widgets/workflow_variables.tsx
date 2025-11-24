import { useCallback, useMemo } from 'react'
import { Braces, Plus } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowVariablesApp from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-variables-app'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import { WORKFLOW_VARIABLES_ADD_EVENT } from '@/widgets/events'
import { widgetHeaderIconButtonClassName } from '@/widgets/components/widget-header-control'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))] px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const WorkflowVariablesWidgetBody = ({
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
  } = useWorkflowWidgetState({
    workspaceId,
    pairColor,
    widget,
    panelId,
    params,
    onWidgetParamsChange,
    fallbackWidgetKey: 'workflow-variables',
    loggerScope: 'workflow variables widget',
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
      <WorkflowVariablesApp
        workspaceId={workspaceId}
        workflowId={resolvedWorkflowId}
        channelId={channelId}
        panelId={panelId}
      />
    </div>
  )
}

type WorkflowVariablesHeaderActionsProps = {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

const WorkflowVariablesHeaderActions = ({
  workspaceId,
  widget,
  panelId,
}: WorkflowVariablesHeaderActionsProps) => {
  const { channelId, resolvedPairColor, widgetKey } = resolveWidgetChannel({
    pairColor: widget?.pairColor,
    widget,
    panelId,
    fallbackWidgetKey: 'workflow-variables',
  })

  const paramsWorkflowId = useMemo(() => {
    if (!widget?.params || typeof widget.params !== 'object') return null
    const value = (widget.params as Record<string, unknown>).workflowId
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }, [widget?.params])

  const activeWorkflowId = useWorkflowRegistry((state) =>
    typeof state.getActiveWorkflowId === 'function'
      ? state.getActiveWorkflowId(channelId)
      : state.activeWorkflowId
  )

  const resolvedWorkflowId =
    resolvedPairColor === 'gray' ? paramsWorkflowId ?? activeWorkflowId : activeWorkflowId

  const isDisabled = !workspaceId || !resolvedWorkflowId

  const handleAddVariable = useCallback(() => {
    if (isDisabled || !resolvedWorkflowId) return

    window.dispatchEvent(
      new CustomEvent(WORKFLOW_VARIABLES_ADD_EVENT, {
        detail: { panelId, channelId, workflowId: resolvedWorkflowId, widgetKey },
      })
    )
  }, [isDisabled, resolvedWorkflowId, panelId, channelId, widgetKey])

  return (
    <button
      type='button'
      className={widgetHeaderIconButtonClassName()}
      title={isDisabled ? 'Select a workflow to add variables' : 'Add variable'}
      disabled={isDisabled}
      onClick={handleAddVariable}
    >
      <Plus className='h-3.5 w-3.5' />
      <span className='sr-only'>Add variable</span>
    </button>
  )
}

export const workflowVariablesWidget: DashboardWidgetDefinition = {
  key: 'workflow_variables',
  title: 'Workflow Variables',
  icon: Braces,
  category: 'utility',
  description: 'Inspect and edit variables for a selected workflow.',
  component: (props) => <WorkflowVariablesWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const workflowId =
      widget?.params && typeof widget.params === 'object' && 'workflowId' in widget.params
        ? (widget.params.workflowId as string)
        : null

    return {
      left: <span className='font-medium text-accent-foreground text-xs'>Variables</span>,
      center: (
        <span className='text-muted-foreground text-xs'>
          {workflowId ? `Workflow: ${workflowId}` : 'Linked workflow'}
        </span>
      ),
      right: (
        <WorkflowVariablesHeaderActions
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
      ),
    }
  },
}
