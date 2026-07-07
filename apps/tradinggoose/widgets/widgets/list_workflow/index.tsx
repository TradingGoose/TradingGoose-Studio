'use client'

import { useCallback, useMemo, useState } from 'react'
import { LayoutList } from 'lucide-react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { usePersistResolvedEntityId } from '@/widgets/utils/entity-selection'
import { usePendingEntitySelection } from '@/widgets/utils/use-pending-entity-selection'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { DashboardWorkflowCreateMenu } from '@/widgets/widgets/list_workflow/components/workflow-create-menu'
import { workflowListWidgetContract } from '@/widgets/widgets/list_workflow/contract'
import { FolderTree, type WorkflowListEntry } from './components/folder-tree/folder-tree'

const WidgetMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const WorkflowListWidgetBody = ({
  context,
  params,
  panelId,
  pairColor = 'gray',
  widget,
  onWidgetParamsPatch,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId ?? null
  const copy = useMessages().workspace.widgets.workflowList
  const widgetParams = params ?? widget?.params ?? null
  const widgetKey = widget?.key ?? 'list_workflow'
  const { channelId, resolvedWorkflowId: selectedWorkflowId } = useWorkflowWidgetState({
    workspaceId: workspaceId ?? undefined,
    pairColor,
    widget,
    panelId,
    params: widgetParams,
    fallbackWidgetKey: 'list_workflow',
  })
  const { members, isLoading, error } = useEntityList('workflow', workspaceId)
  const createWorkflow = useWorkflowRegistry((state) => state.createWorkflow)
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)

  usePersistResolvedEntityId({
    entityId: selectedWorkflowId,
    entityIdKey: 'workflowId',
    onWidgetParamsPatch,
    params: widgetParams,
  })

  // Workflows list newest-first; the projection's canonical name order is a
  // deterministic base, not the workflow list's presentation order.
  const regularWorkflows = useMemo<WorkflowListEntry[]>(
    () =>
      workspaceId
        ? [...members]
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
            .map((member) => {
              return {
                id: member.entityId,
                name: member.entityName,
                description: member.entityDescription ?? '',
                color: getEntityIconColor(member.entityId, member.color),
                workspaceId,
                folderId: member.folderId ?? null,
              }
            })
        : [],
    [members, workspaceId]
  )

  const selectWorkflowId = useCallback(
    (workflowId: string) => {
      onWidgetParamsPatch?.({ workflowId })
    },
    [onWidgetParamsPatch]
  )
  const selectWorkflowIdWhenListed = usePendingEntitySelection(members, selectWorkflowId)

  const handleCreateWorkflow = useCallback(
    async (folderId?: string) => {
      if (!workspaceId) {
        throw new Error('Workspace ID is required to create workflows.')
      }

      if (isCreatingWorkflow) {
        throw new Error('Workflow creation already in progress.')
      }

      try {
        setIsCreatingWorkflow(true)
        const newWorkflowId = await createWorkflow({
          workspaceId,
          folderId: folderId ?? undefined,
        })
        const createdId = newWorkflowId ?? null
        if (createdId) {
          selectWorkflowIdWhenListed(createdId)
        }
        return createdId
      } finally {
        setIsCreatingWorkflow(false)
      }
    },
    [workspaceId, createWorkflow, isCreatingWorkflow, selectWorkflowIdWhenListed]
  )

  const handleWorkflowSelect = useCallback(
    (workflow: WorkflowListEntry) => {
      selectWorkflowIdWhenListed(workflow.id)
    },
    [selectWorkflowIdWhenListed]
  )

  if (!workspaceId) {
    return <WidgetMessage message={copy.body.selectWorkspace} />
  }

  if (error && regularWorkflows.length === 0) {
    return <WidgetMessage message={error} />
  }

  if (isLoading && regularWorkflows.length === 0) {
    return (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <WorkflowRouteProvider
        workspaceId={workspaceId}
        workflowId={selectedWorkflowId ?? 'dashboard-workflow-list'}
        channelId={channelId}
      >
        <div className='h-full w-full overflow-hidden p-2'>
          <FolderTree
            regularWorkflows={regularWorkflows}
            isLoading={isLoading}
            onCreateWorkflow={handleCreateWorkflow}
            workspaceIdOverride={workspaceId}
            workflowIdOverride={selectedWorkflowId}
            onWorkflowSelect={handleWorkflowSelect}
            disableNavigation
          />
        </div>
      </WorkflowRouteProvider>
    </WorkspacePermissionsProvider>
  )
}

export const workflowListWidget: DashboardWidgetDefinition = {
  contract: workflowListWidgetContract,
  icon: LayoutList,
  component: (props) => <WorkflowListWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => ({
    right: (
      <WorkflowListHeaderRight
        workspaceId={context?.workspaceId}
        panelId={panelId}
        pairColor={widget?.pairColor}
        widgetKey={widget?.key ?? 'list_workflow'}
      />
    ),
  }),
}

const WorkflowListHeaderRight = ({
  workspaceId,
  panelId,
  pairColor = 'gray',
  widgetKey,
}: {
  workspaceId?: string
  panelId?: string
  pairColor?: PairColor
  widgetKey: string
}) => {
  const copy = useMessages().workspace.widgets.workflowList
  const { members } = useEntityList('workflow', workspaceId)
  const actions = useWidgetConfigRuntimeActions()
  const selectWorkflowId = useCallback(
    (workflowId: string) => {
      if (!workflowId) {
        return
      }
      if (!panelId) return
      actions.patchWidgetParams(panelId, widgetKey, { workflowId })
    },
    [actions, panelId, widgetKey]
  )
  const selectWorkflowIdWhenListed = usePendingEntitySelection(members, selectWorkflowId)

  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <div className={widgetHeaderButtonGroupClassName()}>
        <DashboardWorkflowCreateMenu
          workspaceId={workspaceId}
          existingWorkflowNames={members.map((member) => member.entityName)}
          onWorkflowCreated={selectWorkflowIdWhenListed}
        />
      </div>
    </WorkspacePermissionsProvider>
  )
}
