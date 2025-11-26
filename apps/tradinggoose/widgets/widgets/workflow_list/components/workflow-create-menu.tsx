'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Folder, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createLogger } from '@/lib/logs/console/logger'
import { generateFolderName } from '@/lib/naming'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/shared/components/widget-header-control'

const logger = createLogger('DashboardWorkflowCreateMenu')

const TIMERS = {
  LONG_PRESS_DELAY: 500,
} as const

export interface DashboardWorkflowCreateMenuProps {
  workspaceId?: string | null
  onWorkflowCreated?: (workflowId: string) => void
}

export function DashboardWorkflowCreateMenu({
  workspaceId,
  onWorkflowCreated,
}: DashboardWorkflowCreateMenuProps) {
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [pressTimer, setPressTimer] = useState<NodeJS.Timeout | null>(null)
  const permissions = useUserPermissionsContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const createFolder = useFolderStore((state) => state.createFolder)
  const createWorkflow = useWorkflowRegistry((state) => state.createWorkflow)
  const [open, setOpen] = useState(false)
  const closeMenu = useCallback(() => setOpen(false), [])

  const isWorkspaceReady = Boolean(workspaceId)
  const isMenuDisabled = !isWorkspaceReady || !permissions.canEdit

  const clearPressTimer = useCallback(() => {
    if (pressTimer) {
      clearTimeout(pressTimer)
      setPressTimer(null)
    }
  }, [pressTimer])

  useEffect(() => {
    return () => clearPressTimer()
  }, [clearPressTimer])

  const handleCreateWorkflow = useCallback(async () => {
    if (!workspaceId || isCreatingWorkflow) {
      return
    }

    setIsCreatingWorkflow(true)

    try {
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      const workflowId = await createWorkflow({ workspaceId })

      if (workflowId) {
        onWorkflowCreated?.(workflowId)
      }
    } catch (error) {
      logger.error('Failed to create workflow from dashboard widget:', { error })
    } finally {
      setIsCreatingWorkflow(false)
    }
  }, [workspaceId, isCreatingWorkflow, createWorkflow, onWorkflowCreated])

  const handleCreateFolder = useCallback(async () => {
    if (!workspaceId || isCreatingFolder) {
      return
    }

    setIsCreatingFolder(true)

    try {
      const folderName = await generateFolderName(workspaceId)
      await createFolder({ name: folderName, workspaceId })
      logger.info(`Created folder ${folderName} from dashboard widget`)
    } catch (error) {
      logger.error('Failed to create folder from dashboard widget:', { error })
    } finally {
      setIsCreatingFolder(false)
    }
  }, [workspaceId, isCreatingFolder, createFolder])

  const handleDirectImport = useCallback(
    async (content: string, filename?: string) => {
      if (!workspaceId) {
        logger.error('Workspace ID is required to import workflows')
        return
      }

      if (!content.trim()) {
        logger.error('JSON content is required')
        return
      }

      setIsImporting(true)

      try {
        const { data: workflowData, errors: parseErrors } = parseWorkflowJson(content)

        if (!workflowData || parseErrors.length > 0) {
          logger.error('Failed to parse JSON:', { errors: parseErrors })
          return
        }

        const getWorkflowName = () => {
          if (filename) {
            const nameWithoutExtension = filename.replace(/\.json$/i, '')
            return (
              nameWithoutExtension.trim() || `Imported Workflow - ${new Date().toLocaleString()}`
            )
          }
          return `Imported Workflow - ${new Date().toLocaleString()}`
        }

        const { clearDiff } = useWorkflowDiffStore.getState()
        clearDiff()

        const newWorkflowId = await createWorkflow({
          name: getWorkflowName(),
          description: 'Workflow imported from JSON',
          workspaceId,
        })

        const response = await fetch(`/api/workflows/${newWorkflowId}/state`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(workflowData),
        })

        if (!response.ok) {
          logger.error('Failed to persist imported workflow to database')
          throw new Error('Failed to save workflow')
        }

        logger.info('Workflow imported successfully from dashboard widget')

        if (newWorkflowId) {
          onWorkflowCreated?.(newWorkflowId)
        }
      } catch (error) {
        logger.error('Failed to import workflow from dashboard widget:', { error })
      } finally {
        setIsImporting(false)
      }
    },
    [workspaceId, createWorkflow, onWorkflowCreated]
  )

  const handleImportWorkflow = useCallback(() => {
    if (!workspaceId) return
    fileInputRef.current?.click()
  }, [workspaceId])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const content = await file.text()
        await handleDirectImport(content, file.name)
      } catch (error) {
        logger.error('Failed to read workflow file:', { error })
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [handleDirectImport]
  )

  const handleButtonClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (isMenuDisabled) return
      clearPressTimer()
      setOpen((prev) => !prev)
    },
    [clearPressTimer, isMenuDisabled]
  )

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (isMenuDisabled) return
      setOpen(true)
    },
    [isMenuDisabled]
  )

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || isMenuDisabled) {
        return
      }
      const timer = setTimeout(() => {
        setOpen(true)
        setPressTimer(null)
      }, TIMERS.LONG_PRESS_DELAY)
      setPressTimer(timer)
    },
    [isMenuDisabled]
  )

  const handleMouseUp = useCallback(() => {
    clearPressTimer()
  }, [clearPressTimer])

  const createWorkflowDisabled = !isWorkspaceReady || isMenuDisabled || isCreatingWorkflow
  const createFolderDisabled = !isWorkspaceReady || isMenuDisabled || isCreatingFolder
  const importWorkflowDisabled = !isWorkspaceReady || isMenuDisabled || isImporting

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            title={
              isWorkspaceReady
                ? 'Create workflow (hover, right-click, or long press for more options)'
                : 'Select a workspace to create workflows'
            }
            disabled={isMenuDisabled}
            onClick={handleButtonClick}
            onContextMenu={handleContextMenu}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
          >
            <Plus className={widgetHeaderMenuIconClassName} />
            <span className='sr-only'>Create workflow</span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-44')}
        >
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={createWorkflowDisabled}
            onSelect={(event) => {
              event.preventDefault()
              if (createWorkflowDisabled) return
              closeMenu()
              void handleCreateWorkflow()
            }}
          >
            <Plus className={widgetHeaderMenuTextClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {isCreatingWorkflow ? 'Creating...' : 'New workflow'}
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={createFolderDisabled}
            onSelect={(event) => {
              event.preventDefault()
              if (createFolderDisabled) return
              closeMenu()
              void handleCreateFolder()
            }}
          >
            <Folder className={widgetHeaderMenuTextClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {isCreatingFolder ? 'Creating...' : 'New folder'}
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={importWorkflowDisabled}
            onSelect={(event) => {
              event.preventDefault()
              if (importWorkflowDisabled) return
              closeMenu()
              handleImportWorkflow()
            }}
          >
            <Download className={widgetHeaderMenuTextClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {isImporting ? 'Importing...' : 'Import workflow'}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type='file'
        accept='.json'
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  )
}
