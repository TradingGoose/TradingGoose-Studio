import { useCallback } from 'react'
import { Braces, Plus } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { widgetHeaderIconButtonClassName } from '@/components/widget-header-control'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useWorkflowDropdownMessages,
  useWorkflowVariablesMessages,
} from '@/i18n/workspace-widget-hooks'
import { WORKFLOW_VARIABLES_ADD_EVENT } from '@/widgets/events'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { WorkflowDropdown } from '@/widgets/widgets/components/workflow-dropdown'
import { workflowVariablesWidgetContract } from '@/widgets/widgets/workflow_variables/contract'
import WorkflowVariablesApp from './components/workflow-variables-app'

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const WorkflowVariablesWidgetBody = ({
  channelId,
  params,
  context,
  panelId,
}: WidgetComponentProps) => {
  const copy = useWorkflowVariablesMessages()
  const dropdownCopy = useWorkflowDropdownMessages()
  const workspaceId = context?.workspaceId
  const { resolvedWorkflowId, hasLoadedWorkflows, loadError, isLoading, workflowIds } =
    useWorkflowWidgetState({
      workspaceId,
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
      <div className='flex h-full w-full items-center justify-center '>
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
  channelId: string
  workspaceId?: string
  params?: Record<string, unknown> | null
  panelId?: string
}

const WorkflowVariablesHeaderActions = ({
  channelId,
  workspaceId,
  params,
  panelId,
}: WorkflowVariablesHeaderActionsProps) => {
  const copy = useWorkflowVariablesMessages()
  const { canEdit } = useUserPermissionsContext()
  const { resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    params,
  })

  const isDisabled = !canEdit || !workspaceId || !resolvedWorkflowId

  const handleAddVariable = useCallback(() => {
    if (isDisabled || !resolvedWorkflowId) return

    window.dispatchEvent(
      new CustomEvent(WORKFLOW_VARIABLES_ADD_EVENT, {
        detail: { channelId, panelId, workflowId: resolvedWorkflowId },
      })
    )
  }, [channelId, isDisabled, panelId, resolvedWorkflowId])

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            disabled={isDisabled}
            onClick={handleAddVariable}
          >
            <Plus className='h-3.5 w-3.5' />
            <span className='sr-only'>{copy.addVariable}</span>
          </button>
        }
      />
      <TooltipContent side='top'>
        {isDisabled ? copy.selectWorkflowToAddVariables : copy.addWorkflowVariable}
      </TooltipContent>
    </Tooltip>
  )
}

type WorkflowVariablesHeaderWorkflowSelectorProps = {
  workspaceId?: string
  params?: Record<string, unknown> | null
}

const WorkflowVariablesHeaderWorkflowSelector = ({
  workspaceId,
  params,
}: WorkflowVariablesHeaderWorkflowSelectorProps) => {
  const { resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    params,
  })
  const actions = useWidgetConfigRuntimeActions()

  const handleWorkflowChange = useCallback(
    (workflowId: string) => {
      actions.patchWidgetLinkedParams?.({ workflowId })
    },
    [actions]
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

export const workflowVariablesWidget: DashboardWidgetDefinition = {
  contract: workflowVariablesWidgetContract,
  icon: Braces,
  component: (props) => <WorkflowVariablesWidgetBody {...props} />,
  renderHeader: ({ channelId, widget, context, panelId }) => {
    return {
      center: (
        <WorkflowVariablesHeaderWorkflowSelector
          workspaceId={context?.workspaceId}
          params={widget?.params}
        />
      ),
      right: (
        <WorkflowVariablesHeaderActions
          channelId={channelId}
          workspaceId={context?.workspaceId}
          params={widget?.params}
          panelId={panelId}
        />
      ),
    }
  },
}
