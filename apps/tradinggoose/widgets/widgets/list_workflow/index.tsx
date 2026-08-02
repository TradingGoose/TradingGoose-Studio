'use client'

import { useCallback, useMemo } from 'react'
import { LayoutList } from 'lucide-react'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useFolders } from '@/hooks/queries/folders'
import { formatTemplate } from '@/i18n/utils'
import { type FolderWrite, useFolderStore } from '@/stores/folders/store'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
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

const getFolderWriteCopy = (
  copy: ReturnType<typeof useMessages>['workspace']['widgets']['workflowList']['folderWrites'],
  write: FolderWrite,
  suffix: 'Pending' | 'Failed'
) => formatTemplate(copy[`${write.kind}${suffix}`], { name: write.name })

const WorkflowListWidgetBody = ({
  channelId,
  context,
  panelId,
  params,
  onWidgetLinkedParamsPatch,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId ?? null
  const ownerId = panelId ?? channelId
  const copy = useMessages().workspace.widgets.workflowList
  const { resolvedWorkflowId: selectedWorkflowId } = useWorkflowWidgetState({
    workspaceId: workspaceId ?? undefined,
    params,
  })
  const { members, isLoading, error } = useEntityList('workflow', workspaceId)
  const foldersQuery = useFolders(workspaceId ?? undefined)
  const activeFolderWrite = useFolderStore((state) =>
    state.activeWrite?.ownerId === ownerId && state.activeWrite.workspaceId === workspaceId
      ? state.activeWrite
      : null
  )
  const folderWriteError = useFolderStore((state) =>
    state.writeError?.ownerId === ownerId && state.writeError.workspaceId === workspaceId
      ? state.writeError
      : null
  )

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
      onWidgetLinkedParamsPatch?.({ workflowId })
    },
    [onWidgetLinkedParamsPatch]
  )
  const selectWorkflowIdWhenListed = usePendingEntitySelection(members, selectWorkflowId)

  const handleWorkflowSelect = useCallback(
    (workflow: WorkflowListEntry) => {
      selectWorkflowIdWhenListed(workflow.id)
    },
    [selectWorkflowIdWhenListed]
  )

  if (!workspaceId) {
    return <WidgetMessage message={copy.body.selectWorkspace} />
  }

  const content =
    error && regularWorkflows.length === 0 ? (
      <WidgetMessage message={error} />
    ) : isLoading && regularWorkflows.length === 0 ? (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    ) : (
      <FolderTree
        regularWorkflows={regularWorkflows}
        isLoading={isLoading || foldersQuery.isPending}
        workspaceIdOverride={workspaceId}
        workflowIdOverride={selectedWorkflowId}
        ownerId={ownerId}
        onWorkflowSelect={handleWorkflowSelect}
        disableNavigation
      />
    )
  const refreshFailure = folderWriteError?.failure === 'refresh'
  const folderQueryFailure =
    !folderWriteError &&
    (foldersQuery.isError || (foldersQuery.isPending && foldersQuery.isFetched))
  const refreshPending = Boolean((refreshFailure || folderQueryFailure) && foldersQuery.isFetching)
  const folderFeedback = refreshPending
    ? copy.folderWrites.refreshPending
    : folderWriteError
      ? refreshFailure
        ? formatTemplate(copy.folderWrites.refreshFailed, { name: folderWriteError.name })
        : getFolderWriteCopy(copy.folderWrites, folderWriteError, 'Failed')
      : folderQueryFailure
        ? copy.body.unableToLoadFolders
        : null

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <WorkflowRouteProvider
        workspaceId={workspaceId}
        workflowId={selectedWorkflowId ?? 'dashboard-workflow-list'}
        channelId={channelId}
      >
        <div className='flex h-full w-full flex-col overflow-hidden p-2'>
          {activeFolderWrite && (
            <p
              role='status'
              aria-atomic='true'
              className='mb-2 rounded-md bg-muted/40 px-2 py-1.5 text-muted-foreground text-xs'
            >
              {getFolderWriteCopy(copy.folderWrites, activeFolderWrite, 'Pending')}
            </p>
          )}
          {!activeFolderWrite && folderFeedback && (
            <div
              role={refreshPending ? 'status' : 'alert'}
              aria-atomic='true'
              className='mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-destructive text-xs'
            >
              {folderFeedback}
              {(refreshFailure || folderQueryFailure) && !refreshPending && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='ml-2 h-7'
                  onClick={() => {
                    void foldersQuery.refetch()
                  }}
                >
                  {copy.folderWrites.refreshAction}
                </Button>
              )}
            </div>
          )}
          <div className='min-h-0 flex-1'>{content}</div>
        </div>
      </WorkflowRouteProvider>
    </WorkspacePermissionsProvider>
  )
}

export const workflowListWidget: DashboardWidgetDefinition = {
  contract: workflowListWidgetContract,
  icon: LayoutList,
  component: (props) => <WorkflowListWidgetBody {...props} />,
  renderHeader: ({ channelId, context, panelId }) => ({
    right: (
      <WorkflowListHeaderRight ownerId={panelId ?? channelId} workspaceId={context?.workspaceId} />
    ),
  }),
}

const WorkflowListHeaderRight = ({
  ownerId,
  workspaceId,
}: {
  ownerId: string
  workspaceId?: string
}) => {
  const copy = useMessages().workspace.widgets.workflowList
  const { members } = useEntityList('workflow', workspaceId)
  const actions = useWidgetConfigRuntimeActions()
  const selectWorkflowId = useCallback(
    (workflowId: string) => {
      if (!workflowId) {
        return
      }
      actions.patchWidgetLinkedParams?.({ workflowId })
    },
    [actions]
  )
  const selectWorkflowIdWhenListed = usePendingEntitySelection(members, selectWorkflowId)

  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <div className={widgetHeaderButtonGroupClassName()}>
        <DashboardWorkflowCreateMenu
          ownerId={ownerId}
          workspaceId={workspaceId}
          existingWorkflowNames={members.map((member) => member.entityName)}
          onWorkflowCreated={selectWorkflowIdWhenListed}
        />
      </div>
    </WorkspacePermissionsProvider>
  )
}
