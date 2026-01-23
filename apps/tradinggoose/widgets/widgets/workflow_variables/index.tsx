import { useCallback, useMemo } from 'react'
import { Braces, Plus } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WORKFLOW_VARIABLES_ADD_EVENT } from '@/widgets/events'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'
import { WorkflowDropdown } from '@/widgets/widgets/components/workflow-dropdown'
import {
  emitWorkflowSelectionChange,
  useWorkflowSelectionPersistence,
} from '@/widgets/utils/workflow-selection'
import WorkflowVariablesApp from './components/workflow-variables-app'

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center  px-4 text-center text-muted-foreground text-xs'>
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
    fallbackWidgetKey: 'workflow-variables',
    loggerScope: 'workflow variables widget',
  })

  useWorkflowSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    pairColor: resolvedPairColor,
    params,
  })

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
    <div className='flex h-full w-full overflow-hidden '>
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
    state.getActiveWorkflowId(channelId)
  )

  const resolvedWorkflowId =
    resolvedPairColor === 'gray' ? (paramsWorkflowId ?? activeWorkflowId) : activeWorkflowId

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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          className={widgetHeaderIconButtonClassName()}
          disabled={isDisabled}
          onClick={handleAddVariable}
        >
          <Plus className='h-3.5 w-3.5' />
          <span className='sr-only'>Add variable</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side='top'>
        {isDisabled ? 'Select a workflow to add variables' : 'Add workflow variable'}
      </TooltipContent>
    </Tooltip>
  )
}

type WorkflowVariablesHeaderWorkflowSelectorProps = {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

const WorkflowVariablesHeaderWorkflowSelector = ({
  workspaceId,
  widget,
  panelId,
}: WorkflowVariablesHeaderWorkflowSelectorProps) => {
  const { resolvedPairColor, resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    panelId,
    params: widget?.params ?? null,
    fallbackWidgetKey: 'workflow-variables',
    loggerScope: 'workflow variables header',
    activateWorkflow: false,
  })

  const handleWorkflowChange = useCallback(
    (workflowId: string) => {
      if (resolvedPairColor !== 'gray') {
        return
      }

      emitWorkflowSelectionChange({
        panelId,
        widgetKey: widget?.key,
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
      center: (
        <WorkflowVariablesHeaderWorkflowSelector
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
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
