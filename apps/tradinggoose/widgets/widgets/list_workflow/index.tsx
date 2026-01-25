'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutList } from 'lucide-react'
import { shallow } from 'zustand/shallow'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { FolderTree } from './components/folder-tree/folder-tree'
import { useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { DashboardWorkflowCreateMenu } from '@/widgets/widgets/list_workflow/components/workflow-create-menu'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'

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
  const { workflows, isLoading, loadWorkflows, createWorkflow, activeWorkflowId } =
    useWorkflowRegistry(
      (state) => ({
        workflows: state.workflows,
        isLoading: state.isLoading,
        loadWorkflows: state.loadWorkflows,
        createWorkflow: state.createWorkflow,
        activeWorkflowId: state.getActiveWorkflowId(),
      }),
      shallow
    )
  const [hasInitialized, setHasInitialized] = useState(!workspaceId)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)
  const setPairContext = useSetPairColorContext()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
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

  const workspaceHasWorkflows = useMemo(() => {
    if (!workspaceId) {
      return false
    }
    return Object.values(workflows ?? {}).some((workflow) => workflow?.workspaceId === workspaceId)
  }, [workflows, workspaceId])

  useEffect(() => {
    if (!workspaceId) {
      setHasInitialized(true)
      setLoadError(null)
      return
    }

    if (workspaceHasWorkflows) {
      setHasInitialized(true)
      setLoadError(null)
      return
    }

    let cancelled = false
    setHasInitialized(false)
    setLoadError(null)

    loadWorkflows(workspaceId)
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load workflows for dashboard workflow list widget', error)
          setLoadError('Unable to load workflows for this workspace.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHasInitialized(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, workspaceHasWorkflows, loadWorkflows])

  const { regularWorkflows, marketplaceWorkflows } = useMemo(() => {
    const regular: WorkflowMetadata[] = []
    const marketplace: WorkflowMetadata[] = []

    if (!workspaceId) {
      return { regularWorkflows: regular, marketplaceWorkflows: marketplace }
    }

    const sortByCreatedAt = (a: WorkflowMetadata, b: WorkflowMetadata) =>
      b.createdAt.getTime() - a.createdAt.getTime()

    Object.values(workflows ?? {}).forEach((workflow) => {
      if (!workflow || workflow.workspaceId !== workspaceId) {
        return
      }

      if (workflow.marketplaceData?.status === 'temp') {
        marketplace.push(workflow)
      } else {
        regular.push(workflow)
      }
    })

    regular.sort(sortByCreatedAt)
    marketplace.sort(sortByCreatedAt)

    return { regularWorkflows: regular, marketplaceWorkflows: marketplace }
  }, [workflows, workspaceId])

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

    if (activeWorkflowId && workflows?.[activeWorkflowId]?.workspaceId === workspaceId) {
      return activeWorkflowId
    }

    return regularWorkflows[0]?.id ?? null
  }, [selectedWorkflowId, activeWorkflowId, regularWorkflows, workspaceId, workflows])

  const syntheticPathname =
    workspaceId && effectiveActiveWorkflowId
      ? `/workspace/${workspaceId}/w/${effectiveActiveWorkflowId}`
      : ''

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
        const { clearDiff } = useWorkflowDiffStore.getState()
        clearDiff()
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
    return <WidgetMessage message='Select a workspace to browse its workflow folders.' />
  }

  if (loadError) {
    return <WidgetMessage message={loadError} />
  }

  if (!hasInitialized) {
    return (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <WorkflowRouteProvider
        workspaceId={workspaceId}
        workflowId={effectiveActiveWorkflowId ?? 'dashboard-workflow-list'}
        channelId='dashboard-workflow-list'
      >
        <div className='h-full w-full overflow-hidden p-2'>
          <FolderTree
            regularWorkflows={regularWorkflows}
            marketplaceWorkflows={marketplaceWorkflows}
            isLoading={isLoading || !hasInitialized}
            onCreateWorkflow={handleCreateWorkflow}
            workspaceIdOverride={workspaceId}
            workflowIdOverride={effectiveActiveWorkflowId}
            pathnameOverride={syntheticPathname}
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
    return <span className='text-muted-foreground text-xs'>Explorer</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <div className='flex items-center gap-2'>
        <DashboardWorkflowCreateMenu
          workspaceId={workspaceId}
          onWorkflowCreated={handleWorkflowCreated}
        />
      </div>
    </WorkspacePermissionsProvider>
  )
}
