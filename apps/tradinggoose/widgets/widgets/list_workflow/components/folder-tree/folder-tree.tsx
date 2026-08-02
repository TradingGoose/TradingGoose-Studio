'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Skeleton } from '@/components/ui/skeleton'
import { createLogger } from '@/lib/logs/console/logger'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadataSeed } from '@/stores/workflows/registry/types'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { FolderItem } from './components/folder-item'
import { WorkflowItem } from './components/workflow-item'

const logger = createLogger('FolderTree')

export type WorkflowListEntry = WorkflowMetadataSeed

interface FolderSectionProps {
  folder: FolderTreeNode
  level: number
  onWorkflowSelect?: (workflow: WorkflowListEntry) => void
  disableNavigation?: boolean
  workflowsByFolder: Record<string, WorkflowListEntry[]>
  expandedFolders: Set<string>
  activeWorkflowId: string | null
  updateWorkflow: (
    id: string,
    updates: Partial<Pick<WorkflowListEntry, 'folderId'>>
  ) => Promise<void>
  moveFolder: (id: string, name: string, parentId: string | null) => Promise<void>
  ownerId: string
  folderWritesDisabled: boolean
  canDeleteWorkflow: boolean
  parentDragOver?: boolean
}

// Helper function to count visible items, excluding content of the last expanded folder
const countVisibleItemsForLine = (
  folder: FolderTreeNode,
  workflowsByFolder: Record<string, WorkflowListEntry[]>,
  expandedFolders: Set<string>
): number => {
  if (!expandedFolders.has(folder.id)) {
    return 0 // Folder is collapsed, no visible children
  }

  let count = 0
  const workflowsInFolder = workflowsByFolder[folder.id] || []

  // Count workflows in this folder
  count += workflowsInFolder.length

  // Count child folders
  folder.children.forEach((childFolder, index) => {
    const isLastChildFolder = index === folder.children.length - 1
    // In the rendering order: workflows come first, then folders
    // So if this is the last child folder, it's the absolute last item
    const isAbsoluteLastItem = isLastChildFolder

    count += 1 // The folder itself

    // Only include expanded content if this is NOT the absolute last item
    if (!isAbsoluteLastItem) {
      count += countVisibleItemsForLine(childFolder, workflowsByFolder, expandedFolders)
    }
    // If this IS the last folder and it's expanded, we don't count its content
    // because the line should stop at this folder's connection point
  })

  return count
}

function FolderSection({
  folder,
  level,
  onWorkflowSelect,
  disableNavigation = false,
  workflowsByFolder,
  expandedFolders,
  activeWorkflowId,
  updateWorkflow,
  moveFolder,
  ownerId,
  folderWritesDisabled,
  canDeleteWorkflow,
  parentDragOver = false,
}: FolderSectionProps) {
  const { isDragOver, isInvalidDrop, handleDragOver, handleDragLeave, handleDrop } =
    useDragHandlers(
      updateWorkflow,
      moveFolder,
      folder.id,
      folder.workspaceId,
      folderWritesDisabled,
      `Moved workflow(s) to folder ${folder.id}`
    )

  const workflowsInFolder = workflowsByFolder[folder.id] || []
  const isAnyDragOver = isDragOver || parentDragOver
  const hasChildren = workflowsInFolder.length > 0 || folder.children.length > 0
  const isExpanded = expandedFolders.has(folder.id)

  // Calculate the height for the vertical connecting line
  const visibleItemsCount = countVisibleItemsForLine(folder, workflowsByFolder, expandedFolders)
  const lineHeight = visibleItemsCount > 0 ? (visibleItemsCount - 1) * 36 + 24 : 0

  return (
    <div
      className={clsx(
        'relative',
        isDragOver &&
          (isInvalidDrop
            ? 'before:pointer-events-none before:absolute before:inset-0 before:rounded-sm before:border before:border-destructive/50 before:bg-destructive/15'
            : 'before:pointer-events-none before:absolute before:inset-0 before:rounded-sm before:border before:border-muted-foreground/50 before:bg-muted/20')
      )}
    >
      {/* Render folder */}
      <div style={{ paddingLeft: `${level * 20}px` }}>
        <FolderItem
          folder={folder}
          dragOver={isDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          ownerId={ownerId}
        />
      </div>

      {/* Render children with connecting lines */}
      {isExpanded && hasChildren && (
        <div className='relative'>
          {/* Vertical line from folder icon to children */}
          {(workflowsInFolder.length > 0 || folder.children.length > 0) && (
            <div
              className='pointer-events-none absolute'
              style={{
                left: `${level * 20 + 16}px`,
                top: '-9px',
                width: '1px',
                height: `${lineHeight}px`,
                background: 'hsl(var(--muted-foreground) / 0.3)',
                zIndex: 1,
              }}
            />
          )}

          {/* Render workflows in this folder */}
          {workflowsInFolder.length > 0 && (
            <div>
              {workflowsInFolder.map((workflow) => (
                <div key={workflow.id} className='relative'>
                  {/* Curved corner */}
                  <div
                    className='pointer-events-none absolute'
                    style={{
                      left: `${level * 20 + 16}px`,
                      top: '15px',
                      width: '4px',
                      height: '4px',
                      borderLeft: '1px solid hsl(var(--muted-foreground) / 0.3)',
                      borderBottom: '1px solid hsl(var(--muted-foreground) / 0.3)',
                      borderBottomLeftRadius: '4px',
                      zIndex: 1,
                    }}
                  />
                  {/* Horizontal line to workflow */}
                  <div
                    className='pointer-events-none absolute'
                    style={{
                      left: `${level * 20 + 20}px`,
                      top: '18px',
                      width: '7px',
                      height: '1px',
                      background: 'hsl(var(--muted-foreground) / 0.3)',
                      zIndex: 1,
                    }}
                  />
                  {/* Workflow container with proper indentation */}
                  <div style={{ paddingLeft: `${(level + 1) * 20 + 8}px` }}>
                    <WorkflowItem
                      workflow={workflow}
                      active={activeWorkflowId === workflow.id}
                      isDragOver={isAnyDragOver}
                      onSelect={onWorkflowSelect}
                      disableNavigation={disableNavigation}
                      canDelete={canDeleteWorkflow}
                      folderWritesDisabled={folderWritesDisabled}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Render child folders */}
          {folder.children.length > 0 && (
            <div>
              {folder.children.map((childFolder) => (
                <div key={childFolder.id} className='relative'>
                  {/* Curved corner */}
                  <div
                    className='pointer-events-none absolute'
                    style={{
                      left: `${level * 20 + 16}px`,
                      top: '15px',
                      width: '4px',
                      height: '4px',
                      borderLeft: '1px solid hsl(var(--muted-foreground) / 0.3)',
                      borderBottom: '1px solid hsl(var(--muted-foreground) / 0.3)',
                      borderBottomLeftRadius: '4px',
                      zIndex: 1,
                    }}
                  />
                  {/* Horizontal line to child folder */}
                  <div
                    className='pointer-events-none absolute'
                    style={{
                      left: `${level * 20 + 20}px`,
                      top: '18px',
                      width: '5px',
                      height: '1px',
                      background: 'hsl(var(--muted-foreground) / 0.3)',
                      zIndex: 1,
                    }}
                  />
                  <div style={{ paddingLeft: '8px' }}>
                    <FolderSection
                      key={childFolder.id}
                      folder={childFolder}
                      level={level + 1}
                      onWorkflowSelect={onWorkflowSelect}
                      disableNavigation={disableNavigation}
                      workflowsByFolder={workflowsByFolder}
                      expandedFolders={expandedFolders}
                      activeWorkflowId={activeWorkflowId}
                      updateWorkflow={updateWorkflow}
                      moveFolder={moveFolder}
                      ownerId={ownerId}
                      folderWritesDisabled={folderWritesDisabled}
                      canDeleteWorkflow={canDeleteWorkflow}
                      parentDragOver={isAnyDragOver}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Custom hook for drag and drop handling
function useDragHandlers(
  updateWorkflow: (
    id: string,
    updates: Partial<Pick<WorkflowListEntry, 'folderId'>>
  ) => Promise<void>,
  moveFolder: (id: string, name: string, parentId: string | null) => Promise<void>,
  targetFolderId: string | null, // null for root
  workspaceId: string | null,
  folderWritesDisabled: boolean,
  logMessage?: string
) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isInvalidDrop, setIsInvalidDrop] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    const folderState = useFolderStore.getState()
    if (
      folderWritesDisabled ||
      !workspaceId ||
      folderState.activeWrite ||
      folderState.folderDataReady[workspaceId] !== true
    ) {
      setIsDragOver(false)
      setIsInvalidDrop(false)
      return
    }

    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)

    // Check if this would be an invalid folder drop
    const draggedFolderId =
      (typeof window !== 'undefined' && (window as any).currentDragFolderId) || null

    if (draggedFolderId && targetFolderId) {
      const folderStore = useFolderStore.getState()
      const targetFolderPath = folderStore.getFolderPath(targetFolderId)

      // Check for circular reference
      const draggedFolderPath = folderStore.getFolderPath(draggedFolderId)
      const isCircular =
        targetFolderId === draggedFolderId ||
        draggedFolderPath.some((ancestor) => ancestor.id === targetFolderId)

      // Check for deep nesting - prevent triple nesting (folder -> folder -> folder)
      // targetFolderPath includes the target folder itself, so:
      // - length 1: root folder (allow drop - creates 2 levels: target -> dropped)
      // - length 2: nested folder (prevent drop - would create 3 levels: grandparent -> target -> dropped)
      const wouldBeTripleNested = targetFolderPath.length >= 2

      setIsInvalidDrop(isCircular || wouldBeTripleNested)
    } else {
      setIsInvalidDrop(false)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    setIsInvalidDrop(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    setIsInvalidDrop(false)

    const folderState = useFolderStore.getState()
    if (
      !workspaceId ||
      folderState.activeWrite ||
      folderState.folderDataReady[workspaceId] !== true
    ) {
      return
    }

    // Handle workflow drops
    const workflowIdsData = e.dataTransfer.getData('workflow-ids')
    if (workflowIdsData) {
      const workflowIds = JSON.parse(workflowIdsData) as string[]

      try {
        // Update workflows sequentially to avoid race conditions
        for (const workflowId of workflowIds) {
          await updateWorkflow(workflowId, { folderId: targetFolderId })
        }
        logger.info(logMessage || `Moved ${workflowIds.length} workflow(s)`)
      } catch (error) {
        logger.error('Failed to move workflows:', error)
      }
    }

    // Handle folder drops
    const folderIdData = e.dataTransfer.getData('folder-id')
    if (folderIdData) {
      try {
        // Check if the target folder would create triple nesting
        const folderStore = useFolderStore.getState()
        const targetFolderPath = targetFolderId ? folderStore.getFolderPath(targetFolderId) : []

        // Prevent circular references - don't allow dropping a folder into itself or its descendants
        if (targetFolderId === folderIdData) {
          logger.info('Cannot move folder into itself')
          return
        }

        // Check if target folder is a descendant of the dragged folder
        const draggedFolderPath = folderStore.getFolderPath(folderIdData)
        if (
          targetFolderId &&
          draggedFolderPath.some((ancestor) => ancestor.id === targetFolderId)
        ) {
          logger.info('Cannot move folder into its own descendant')
          return
        }

        // Prevent triple nesting: folder -> folder -> folder
        // targetFolderPath includes the target folder itself, so:
        // - length 0: dropping into root (creates 1 level)
        // - length 1: dropping into root folder (creates 2 levels: target -> dropped) - allowed
        // - length 2+: dropping into nested folder (creates 3+ levels) - prevent
        if (targetFolderPath.length >= 2) {
          logger.info(
            'Cannot nest folder: Maximum 2 levels of nesting allowed (folder -> folder). Triple nesting prevented.'
          )
          return // Prevent the drop entirely
        }

        // Safe to nest - either dropping into root or into a root-level folder
        const folderName = folderStore.getFolderById(folderIdData)?.name ?? folderIdData
        await moveFolder(folderIdData, folderName, targetFolderId)
        logger.info(`Moved folder to ${targetFolderId ? `folder ${targetFolderId}` : 'root'}`)
      } catch (error) {
        logger.error('Failed to move folder:', error)
      }
    }
  }

  return {
    isDragOver,
    isInvalidDrop,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}

interface FolderTreeProps {
  regularWorkflows: WorkflowListEntry[]
  isLoading?: boolean
  workspaceIdOverride?: string | null
  workflowIdOverride?: string | null
  ownerId: string
  onWorkflowSelect?: (workflow: WorkflowListEntry) => void
  disableNavigation?: boolean
}

export function FolderTree({
  regularWorkflows,
  isLoading = false,
  workspaceIdOverride = null,
  workflowIdOverride = null,
  ownerId,
  onWorkflowSelect,
  disableNavigation = false,
}: FolderTreeProps) {
  const routeContext = useOptionalWorkflowRoute()
  const queryClient = useQueryClient()
  const workspaceId = workspaceIdOverride ?? routeContext?.workspaceId ?? null
  const workflowId = workflowIdOverride ?? routeContext?.workflowId ?? null
  const expandedFolders = useFolderStore((state) => state.expandedFolders)
  const clearSelection = useFolderStore((state) => state.clearSelection)
  const getFolderPath = useFolderStore((state) => state.getFolderPath)
  const setExpanded = useFolderStore((state) => state.setExpanded)
  const activeFolderWrite = useFolderStore((state) => state.activeWrite)
  const folderDataReady = useFolderStore((state) =>
    workspaceId ? state.folderDataReady[workspaceId] === true : false
  )
  const writeFolder = useFolderStore((state) => state.writeFolder)
  const folderTree = useFolderStore(
    useCallback((state) => (workspaceId ? state.getFolderTree(workspaceId) : []), [workspaceId])
  )
  const { updateWorkflow } = useWorkflowRegistry()
  const folderWritesDisabled = Boolean(activeFolderWrite) || !folderDataReady
  const moveFolder = useCallback(
    async (id: string, name: string, parentId: string | null) => {
      if (!workspaceId) return
      await writeFolder({ kind: 'move', workspaceId, ownerId, id, name, parentId }, queryClient)
    },
    [ownerId, queryClient, workspaceId, writeFolder]
  )

  // Memoize the active workflow's folder ID to avoid unnecessary re-runs
  const activeWorkflowFolderId = useMemo(() => {
    if (!workflowId || isLoading) return null
    const activeWorkflow = regularWorkflows.find((workflow) => workflow.id === workflowId)
    return activeWorkflow?.folderId || null
  }, [workflowId, regularWorkflows, isLoading])

  // Auto-expand folders when a workflow is active
  useEffect(() => {
    if (!activeWorkflowFolderId) return

    // Get the folder path from root to the workflow's folder
    const folderPath = getFolderPath(activeWorkflowFolderId)

    // Expand all folders in the path (only if not already expanded)
    folderPath.forEach((folder) => {
      if (!expandedFolders.has(folder.id)) {
        setExpanded(folder.id, true)
      }
    })
  }, [activeWorkflowFolderId, getFolderPath, setExpanded])

  useEffect(() => {
    clearSelection()
  }, [workspaceId, clearSelection])

  // Group workflows by folder
  const workflowsByFolder = regularWorkflows.reduce(
    (acc, workflow) => {
      const folderId = workflow.folderId || 'root'
      if (!acc[folderId]) acc[folderId] = []
      acc[folderId].push(workflow)
      return acc
    },
    {} as Record<string, WorkflowListEntry[]>
  )
  const canDeleteWorkflow = regularWorkflows.length > 1

  const {
    isDragOver: rootDragOver,
    isInvalidDrop: rootInvalidDrop,
    handleDragOver: handleRootDragOver,
    handleDragLeave: handleRootDragLeave,
    handleDrop: handleRootDrop,
  } = useDragHandlers(
    updateWorkflow,
    moveFolder,
    null,
    workspaceId,
    folderWritesDisabled,
    'Moved workflow(s) to root'
  )

  const renderFolderTree = (
    nodes: FolderTreeNode[],
    level = 0,
    parentDragOver = false
  ): React.ReactNode[] => {
    return nodes.map((folder) => (
      <FolderSection
        key={folder.id}
        folder={folder}
        level={level}
        onWorkflowSelect={onWorkflowSelect}
        disableNavigation={disableNavigation}
        workflowsByFolder={workflowsByFolder}
        expandedFolders={expandedFolders}
        activeWorkflowId={workflowId}
        updateWorkflow={updateWorkflow}
        moveFolder={moveFolder}
        ownerId={ownerId}
        folderWritesDisabled={folderWritesDisabled}
        canDeleteWorkflow={canDeleteWorkflow}
        parentDragOver={parentDragOver}
      />
    ))
  }

  const showLoading = isLoading
  const rootWorkflows = workflowsByFolder.root || []

  // Render skeleton loading state
  const renderSkeletonLoading = () => {
    return (
      <div className='space-y-1 py-2'>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className='flex h-8 items-center rounded-lg px-2 py-2'>
            <Skeleton className='mr-2 h-4 w-4 rounded' />
            <Skeleton className='h-4 max-w-32 flex-1' />
          </div>
        ))}
      </div>
    )
  }

  if (showLoading) {
    return renderSkeletonLoading()
  }

  return (
    <div className='flex h-full flex-col '>
      {/* Folder tree */}
      <div className='space-y-1 '>{renderFolderTree(folderTree, 0, false)}</div>

      {/* Root level workflows and drop zone - fills remaining space */}
      <div
        className={clsx(
          'relative flex-1 ',
          rootDragOver &&
            (rootInvalidDrop
              ? 'before:pointer-events-none before:absolute before:inset-0 before:rounded-sm before:border before:border-destructive/50 before:bg-destructive/15'
              : 'before:pointer-events-none before:absolute before:inset-0 before:rounded-sm before:border before:border-muted-foreground/50 before:bg-muted/20'),
          // Ensure minimum height for drag target when empty
          rootWorkflows.length === 0 ? 'min-h-8' : ''
        )}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        <div className='space-y-1'>
          {rootWorkflows.map((workflow) => (
            <WorkflowItem
              key={workflow.id}
              workflow={workflow}
              active={workflowId === workflow.id}
              isDragOver={rootDragOver}
              onSelect={onWorkflowSelect}
              disableNavigation={disableNavigation}
              canDelete={canDeleteWorkflow}
              folderWritesDisabled={folderWritesDisabled}
            />
          ))}

          {/* Empty state */}
          {!showLoading && regularWorkflows.length === 0 && folderTree.length === 0 && (
            <div className='break-words px-2 py-1.5 pr-12 text-muted-foreground text-xs'>
              No workflows or folders in {workspaceId ? 'this workspace' : 'your account'}. Create
              one to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
