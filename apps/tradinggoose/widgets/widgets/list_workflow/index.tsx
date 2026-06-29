'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutList } from 'lucide-react'
import { useMessages } from 'next-intl'
import { shallow } from 'zustand/shallow'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { getStableVibrantColor } from '@/lib/colors'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { WORKSPACE_BOOTSTRAP_CHANNEL } from '@/stores/workflows/registry/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { DashboardWorkflowCreateMenu } from '@/widgets/widgets/list_workflow/components/workflow-create-menu'
import { FolderTree } from './components/folder-tree/folder-tree'

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
  const selectionChannelId = isLinkedToColorPair
    ? `pair-${resolvedPairColor}`
    : WORKSPACE_BOOTSTRAP_CHANNEL
  const { members, isLoading, error } = useEntityList('workflow', workspaceId)
  const { createWorkflow, activeWorkflowId } = useWorkflowRegistry(
    (state) => ({
      createWorkflow: state.createWorkflow,
      activeWorkflowId: state.getActiveWorkflowId(selectionChannelId),
    }),
    shallow
  )
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)
  const setPairContext = useSetPairColorContext()
  const paramsWorkflowId = useMemo(() => {
    if (isLinkedToColorPair) return null
    if (!widget || !widget.params || typeof widget.params !== 'object') return null
    if (!('workflowId' in widget.params)) return null
    const value = widget.params.workflowId
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }, [isLinkedToColorPair, widget?.params])

  useEffect(() => {
    if (!paramsWorkflowId) return
    if (paramsWorkflowId === selectedWorkflowId) return
    setSelectedWorkflowId(paramsWorkflowId)
  }, [paramsWorkflowId, selectedWorkflowId])

  const regularWorkflows = useMemo<WorkflowMetadata[]>(
    () =>
      workspaceId
        ? members.map((member) => {
            const createdAt = new Date(0)
            return {
              id: member.entityId,
              name: member.entityName,
              description: '',
              color: getStableVibrantColor(member.entityId),
              lastModified: createdAt,
              createdAt,
              marketplaceData: null,
              workspaceId,
              folderId: member.folderId ?? null,
            }
          })
        : [],
    [members, workspaceId]
  )

  useEffect(() => {
    if (!workspaceId) return
    useWorkflowRegistry.setState((state) => ({
      workflows: {
        ...state.workflows,
        ...Object.fromEntries(
          regularWorkflows.map((workflow) => [
            workflow.id,
            {
              ...workflow,
              ...state.workflows[workflow.id],
              name: workflow.name,
              folderId: workflow.folderId,
              workspaceId: workflow.workspaceId,
            },
          ])
        ),
      },
    }))
  }, [regularWorkflows, workspaceId])

  useEffect(() => {
    if (!selectedWorkflowId) {
      return
    }

    if (paramsWorkflowId && selectedWorkflowId === paramsWorkflowId) {
      return
    }

    if (!regularWorkflows.some((w) => w.id === selectedWorkflowId)) {
      setSelectedWorkflowId(null)
    }
  }, [selectedWorkflowId, regularWorkflows, paramsWorkflowId])

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
      setSelectedWorkflowId(detail.workflowId)
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
  }, [
    workspaceId,
    resolvedPairColor,
    isLinkedToColorPair,
    setPairContext,
    setSelectedWorkflowId,
    onWidgetParamsChange,
  ])

  const effectiveActiveWorkflowId = useMemo(() => {
    if (selectedWorkflowId) {
      return selectedWorkflowId
    }

    if (!workspaceId) {
      return null
    }

    if (activeWorkflowId && regularWorkflows.some((workflow) => workflow.id === activeWorkflowId)) {
      return activeWorkflowId
    }

    return regularWorkflows[0]?.id ?? null
  }, [selectedWorkflowId, activeWorkflowId, regularWorkflows, workspaceId])

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
        setSelectedWorkflowId(createdId)
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
    (workflow: WorkflowMetadata) => {
      setSelectedWorkflowId(workflow.id)
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
        workflowId={effectiveActiveWorkflowId ?? 'dashboard-workflow-list'}
        channelId='dashboard-workflow-list'
      >
        <div className='h-full w-full overflow-hidden p-2'>
          <FolderTree
            regularWorkflows={regularWorkflows}
            marketplaceWorkflows={[]}
            isLoading={isLoading}
            onCreateWorkflow={handleCreateWorkflow}
            workspaceIdOverride={workspaceId}
            workflowIdOverride={effectiveActiveWorkflowId}
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
          onWorkflowCreated={handleWorkflowCreated}
        />
      </div>
    </WorkspacePermissionsProvider>
  )
}
