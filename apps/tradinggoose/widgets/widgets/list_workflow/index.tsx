'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutList } from 'lucide-react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { getStableVibrantColor } from '@/lib/colors'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { DashboardWorkflowCreateMenu } from '@/widgets/widgets/list_workflow/components/workflow-create-menu'
import { FolderTree, type WorkflowListEntry } from './components/folder-tree/folder-tree'

const WORKFLOW_LIST_WORKFLOW_CREATED_EVENT = 'dashboard-workflow-list:workflow-created'

type WorkflowListWorkflowCreatedDetail = {
  workspaceId: string
  workflowId: string
}

const WidgetMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const WorkflowListWidgetBody = ({
  context,
  pairColor = 'gray',
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId ?? null
  const copy = useMessages().workspace.widgets.workflowList
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const { members, isLoading, error } = useEntityList('workflow', workspaceId)
  const createWorkflow = useWorkflowRegistry((state) => state.createWorkflow)
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)
  const setPairContext = useSetPairColorContext()
  const rawSelectedWorkflowId = useMemo(() => {
    if (isLinkedToColorPair) return pairContext?.workflowId ?? null
    if (!widget || !widget.params || typeof widget.params !== 'object') return null
    if (!('workflowId' in widget.params)) return null
    const value = widget.params.workflowId
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }, [isLinkedToColorPair, pairContext?.workflowId, widget?.params])

  const regularWorkflows = useMemo<WorkflowListEntry[]>(
    () =>
      workspaceId
        ? members.map((member) => {
            return {
              id: member.entityId,
              name: member.entityName,
              description: member.entityDescription ?? '',
              color: member.color ?? getStableVibrantColor(member.entityId),
              workspaceId,
              folderId: member.folderId ?? null,
            }
          })
        : [],
    [members, workspaceId]
  )

  const selectedWorkflowId =
    rawSelectedWorkflowId &&
    regularWorkflows.some((workflow) => workflow.id === rawSelectedWorkflowId)
      ? rawSelectedWorkflowId
      : null

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<WorkflowListWorkflowCreatedDetail>
      const detail = customEvent.detail
      if (!detail || detail.workspaceId !== workspaceId || !detail.workflowId) {
        return
      }
      if (isLinkedToColorPair) {
        setPairContext(resolvedPairColor, { workflowId: detail.workflowId })
      } else {
        onWidgetParamsChange?.({ workflowId: detail.workflowId })
      }
    }

    window.addEventListener(WORKFLOW_LIST_WORKFLOW_CREATED_EVENT, handler as EventListener)
    return () => {
      window.removeEventListener(WORKFLOW_LIST_WORKFLOW_CREATED_EVENT, handler as EventListener)
    }
  }, [workspaceId, resolvedPairColor, isLinkedToColorPair, setPairContext, onWidgetParamsChange])

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
        if (createdId && isLinkedToColorPair) {
          setPairContext(resolvedPairColor, { workflowId: createdId })
        } else if (createdId) {
          onWidgetParamsChange?.({ workflowId: createdId })
        }
        return createdId
      } finally {
        setIsCreatingWorkflow(false)
      }
    },
    [
      workspaceId,
      createWorkflow,
      isCreatingWorkflow,
      resolvedPairColor,
      isLinkedToColorPair,
      setPairContext,
      onWidgetParamsChange,
    ]
  )

  const handleWorkflowSelect = useCallback(
    (workflow: WorkflowListEntry) => {
      if (isLinkedToColorPair) {
        setPairContext(resolvedPairColor, { workflowId: workflow.id })
      } else {
        onWidgetParamsChange?.({ workflowId: workflow.id })
      }
    },
    [resolvedPairColor, isLinkedToColorPair, setPairContext, onWidgetParamsChange]
  )

  if (!workspaceId) {
    return <WidgetMessage message={copy.body.selectWorkspace} />
  }

  if (error) {
    return <WidgetMessage message={error} />
  }

  if (isLoading) {
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
        channelId='dashboard-workflow-list'
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
  key: 'workflow_list',
  title: 'Workflow List',
  icon: LayoutList,
  category: 'list',
  description: 'Full folder tree with drag-and-drop, identical to the workspace sidebar.',
  component: (props) => <WorkflowListWidgetBody {...props} />,
  renderHeader: ({ context }) => ({
    right: <WorkflowListHeaderRight workspaceId={context?.workspaceId} />,
  }),
}

const WorkflowListHeaderRight = ({ workspaceId }: { workspaceId?: string }) => {
  const copy = useMessages().workspace.widgets.workflowList
  const { members } = useEntityList('workflow', workspaceId)
  const handleWorkflowCreated = useCallback(
    (workflowId: string) => {
      if (!workspaceId || !workflowId) {
        return
      }
      window.dispatchEvent(
        new CustomEvent<WorkflowListWorkflowCreatedDetail>(WORKFLOW_LIST_WORKFLOW_CREATED_EVENT, {
          detail: { workspaceId, workflowId },
        })
      )
    },
    [workspaceId]
  )

  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <div className={widgetHeaderButtonGroupClassName()}>
        <DashboardWorkflowCreateMenu
          workspaceId={workspaceId}
          existingWorkflowNames={members.map((member) => member.entityName)}
          onWorkflowCreated={handleWorkflowCreated}
        />
      </div>
    </WorkspacePermissionsProvider>
  )
}
