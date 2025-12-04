'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { shallow } from 'zustand/shallow'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useFolderStore, useIsWorkflowSelected } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const logger = createLogger('WorkflowItem')

// Helper function to lighten a hex color
function lightenColor(hex: string, percent = 30): string {
  // Remove # if present
  const color = hex.replace('#', '')

  // Parse RGB values
  const num = Number.parseInt(color, 16)
  const r = Math.min(255, Math.floor((num >> 16) + ((255 - (num >> 16)) * percent) / 100))
  const g = Math.min(
    255,
    Math.floor(((num >> 8) & 0x00ff) + ((255 - ((num >> 8) & 0x00ff)) * percent) / 100)
  )
  const b = Math.min(255, Math.floor((num & 0x0000ff) + ((255 - (num & 0x0000ff)) * percent) / 100))

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  isMarketplace?: boolean
  level: number
  isDragOver?: boolean
  onSelect?: (workflow: WorkflowMetadata) => void
  disableNavigation?: boolean
}

export function WorkflowItem({
  workflow,
  active,
  isMarketplace,
  level,
  isDragOver = false,
  onSelect,
  disableNavigation = false,
}: WorkflowItemProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(workflow.name)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [deleteState, setDeleteState] = useState<{
    showDialog: boolean
    isDeleting: boolean
    showTemplateChoice: boolean
    publishedTemplates: { id: string; name: string }[]
  }>({
    showDialog: false,
    isDeleting: false,
    showTemplateChoice: false,
    publishedTemplates: [],
  })
  const dragStartedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const workspaceId = useWorkspaceId()
  const { selectedWorkflows, selectOnly, toggleWorkflowSelection } = useFolderStore()
  const isSelected = useIsWorkflowSelected(workflow.id)
  const { updateWorkflow, removeWorkflow } = useWorkflowRegistry(
    (state) => ({
      updateWorkflow: state.updateWorkflow,
      removeWorkflow: state.removeWorkflow,
    }),
    shallow
  )
  const userPermissions = useUserPermissionsContext()

  // Update editValue when workflow name changes
  useEffect(() => {
    setEditValue(workflow.name)
  }, [workflow.name])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    if (isMarketplace) return
    setIsEditing(true)
    setEditValue(workflow.name)
  }

  const handleSaveEdit = async () => {
    if (!editValue.trim() || editValue.trim() === workflow.name) {
      setIsEditing(false)
      setEditValue(workflow.name)
      return
    }

    setIsRenaming(true)
    try {
      await updateWorkflow(workflow.id, { name: editValue.trim() })
      logger.info(`Successfully renamed workflow from "${workflow.name}" to "${editValue.trim()}"`)
      setIsEditing(false)
    } catch (error) {
      logger.error('Failed to rename workflow:', {
        error,
        workflowId: workflow.id,
        oldName: workflow.name,
        newName: editValue.trim(),
      })
      // Reset to original name on error
      setEditValue(workflow.name)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditValue(workflow.name)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleInputBlur = () => {
    handleSaveEdit()
  }

  const resetDeleteState = useCallback(() => {
    setDeleteState({
      showDialog: false,
      isDeleting: false,
      showTemplateChoice: false,
      publishedTemplates: [],
    })
  }, [])

  const checkPublishedTemplates = useCallback(async (workflowId: string) => {
    const checkResponse = await fetch(`/api/workflows/${workflowId}?check-templates=true`, {
      method: 'DELETE',
    })

    if (!checkResponse.ok) {
      throw new Error(`Failed to check templates: ${checkResponse.statusText}`)
    }

    return checkResponse.json()
  }, [])

  const handleDeleteWorkflow = useCallback(async () => {
    if (!userPermissions.canEdit || isMarketplace) return

    setDeleteState((prev) => ({ ...prev, isDeleting: true }))

    try {
      const checkData = await checkPublishedTemplates(workflow.id)

      if (checkData?.hasPublishedTemplates) {
        setDeleteState((prev) => ({
          ...prev,
          isDeleting: false,
          showTemplateChoice: true,
          publishedTemplates: checkData.publishedTemplates || [],
        }))
        return
      }

      await removeWorkflow(workflow.id)
      resetDeleteState()
    } catch (error) {
      logger.error('Error deleting workflow:', error)
      setDeleteState((prev) => ({ ...prev, isDeleting: false }))
    }
  }, [
    checkPublishedTemplates,
    isMarketplace,
    removeWorkflow,
    resetDeleteState,
    userPermissions.canEdit,
    workflow.id,
  ])

  const handleTemplateAction = useCallback(
    async (action: 'keep' | 'delete') => {
      if (!userPermissions.canEdit || isMarketplace) return

      setDeleteState((prev) => ({ ...prev, isDeleting: true }))

      try {
        await removeWorkflow(workflow.id, action)
        resetDeleteState()
      } catch (error) {
        logger.error('Error deleting workflow with template action:', error)
        setDeleteState((prev) => ({ ...prev, isDeleting: false }))
      }
    },
    [isMarketplace, removeWorkflow, resetDeleteState, userPermissions.canEdit, workflow.id]
  )

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging || isEditing) {
      e.preventDefault()
      return
    }

    if (e.shiftKey) {
      e.preventDefault()
      toggleWorkflowSelection(workflow.id)
      return
    }

    if (!isSelected || selectedWorkflows.size > 1) {
      selectOnly(workflow.id)
    }

    if (onSelect) {
      e.preventDefault()
      onSelect(workflow)
      return
    }

    if (disableNavigation) {
      e.preventDefault()
    }
  }

  const handleDragStart = (e: React.DragEvent) => {
    if (isMarketplace || isEditing) return

    dragStartedRef.current = true
    setIsDragging(true)

    let workflowIds: string[]
    if (isSelected && selectedWorkflows.size > 1) {
      workflowIds = Array.from(selectedWorkflows)
    } else {
      workflowIds = [workflow.id]
    }

    e.dataTransfer.setData('workflow-ids', JSON.stringify(workflowIds))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    requestAnimationFrame(() => {
      dragStartedRef.current = false
    })
  }

  const interactiveChildren = (
    <>
      <span className='flex items-center gap-2'>
        <span
          className='mr-2 h-2.5 w-2.5 rounded-xxs'
          style={{
            backgroundColor: workflow.color,
            boxShadow: `0 0 0 4px ${workflow.color}50`,
          }}
          aria-hidden
        />
      </span>
      {isEditing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleInputBlur}
          className={clsx(
            'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium font-sans text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            active && !isDragOver
              ? 'text-foreground'
              : 'text-muted-foreground group-hover:text-foreground'
          )}
          maxLength={100}
          disabled={isRenaming}
          onClick={(e) => e.preventDefault()} // Prevent navigation when clicking input
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
        />
      ) : !isDragging ? (
        <Tooltip delayDuration={1000}>
          <TooltipTrigger asChild>
            <span
              className={clsx(
                'min-w-0 flex-1 select-none truncate pr-1 font-medium font-sans text-sm',
                active && !isDragOver
                  ? 'text-foreground'
                  : 'text-muted-foreground group-hover:text-foreground'
              )}
            >
              {workflow.name}
              {isMarketplace && ' (Preview)'}
            </span>
          </TooltipTrigger>
          <TooltipContent side='top' align='start' sideOffset={10}>
            <p>
              {workflow.name}
              {isMarketplace && ' (Preview)'}
            </p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span
          className={clsx(
            'min-w-0 flex-1 select-none truncate pr-1 font-medium font-sans text-sm',
            active && !isDragOver ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
          )}
        >
          {workflow.name}
          {isMarketplace && ' (Preview)'}
        </span>
      )}
    </>
  )

  return (
    <div className='mb-1'>
      <div
        className={clsx(
          'group flex h-8 cursor-pointer items-center rounded-sm px-2 py-2 font-medium font-sans text-sm transition-colors',
          active && !isDragOver ? 'bg-muted' : 'hover:bg-card',
          isSelected && selectedWorkflows.size > 1 && !active && !isDragOver ? 'bg-muted' : '',
          isDragging ? 'opacity-50' : ''
        )}
        draggable={!isMarketplace && !isEditing}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        data-workflow-id={workflow.id}
      >
        {disableNavigation ? (
          <button
            type='button'
            onClick={handleClick}
            disabled={isEditing}
            className='flex min-w-0 flex-1 items-center border-0 bg-transparent p-0 text-left'
            draggable={false}
          >
            {interactiveChildren}
          </button>
        ) : (
          <Link
            href={`/workspace/${workspaceId}/w/${workflow.id}`}
            className='flex min-w-0 flex-1 items-center'
            onClick={handleClick}
            draggable={false}
          >
            {interactiveChildren}
          </Link>
        )}

        {!isMarketplace && !isEditing && isHovered && userPermissions.canEdit && (
          <div
            className='flex items-center justify-center gap-1'
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant='ghost'
              size='icon'
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
              onClick={(e) => {
                e.stopPropagation()
                handleStartEdit()
              }}
            >
              <Pencil className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Rename workflow</span>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
              onClick={(e) => {
                e.stopPropagation()
                setDeleteState({
                  showDialog: true,
                  isDeleting: false,
                  showTemplateChoice: false,
                  publishedTemplates: [],
                })
              }}
            >
              <Trash2 className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Delete workflow</span>
            </Button>
          </div>
        )}
      </div>

      <AlertDialog
        open={deleteState.showDialog}
        onOpenChange={(open) => {
          if (!open) {
            resetDeleteState()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteState.showTemplateChoice ? 'Published Templates Found' : 'Delete workflow?'}
            </AlertDialogTitle>
            {deleteState.showTemplateChoice ? (
              <div className='space-y-3'>
                <AlertDialogDescription>
                  This workflow has {deleteState.publishedTemplates.length} published template
                  {deleteState.publishedTemplates.length === 1 ? '' : 's'}:
                </AlertDialogDescription>
                {deleteState.publishedTemplates.length > 0 && (
                  <ul className='list-disc space-y-1 pl-6'>
                    {deleteState.publishedTemplates.map((template) => (
                      <li key={template.id}>{template.name}</li>
                    ))}
                  </ul>
                )}
                <AlertDialogDescription>
                  What would you like to do with the published template
                  {deleteState.publishedTemplates.length === 1 ? '' : 's'}?
                </AlertDialogDescription>
              </div>
            ) : (
              <AlertDialogDescription>
                Deleting this workflow will permanently remove all associated blocks, executions,
                and configuration.{' '}
                <span className='text-red-500 dark:text-red-500'>
                  This action cannot be undone.
                </span>
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>

          <AlertDialogFooter className='flex'>
            {deleteState.showTemplateChoice ? (
              <div className='flex w-full gap-2'>
                <Button
                  variant='outline'
                  onClick={() => handleTemplateAction('keep')}
                  disabled={deleteState.isDeleting}
                  className='h-9 flex-1 rounded-sm'
                >
                  Keep templates
                </Button>
                <Button
                  onClick={() => handleTemplateAction('delete')}
                  disabled={deleteState.isDeleting}
                  className='h-9 flex-1 rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                >
                  {deleteState.isDeleting ? 'Deleting...' : 'Delete templates'}
                </Button>
              </div>
            ) : (
              <>
                <AlertDialogCancel
                  className='h-9 w-full rounded-sm'
                  disabled={deleteState.isDeleting}
                >
                  Cancel
                </AlertDialogCancel>
                <Button
                  onClick={(e) => {
                    e.preventDefault()
                    handleDeleteWorkflow()
                  }}
                  disabled={deleteState.isDeleting}
                  className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                >
                  {deleteState.isDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
