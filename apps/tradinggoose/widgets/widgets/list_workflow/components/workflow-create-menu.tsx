'use client'

import { useCallback, useRef, useState } from 'react'
import { Download, Folder, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { generateFolderName } from '@/lib/naming'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useFolderStore } from '@/stores/folders/store'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

const logger = createLogger('DashboardWorkflowCreateMenu')

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
  const permissions = useUserPermissionsContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const createFolder = useFolderStore((state) => state.createFolder)
  const createWorkflow = useWorkflowRegistry((state) => state.createWorkflow)

  const isWorkspaceReady = Boolean(workspaceId)
  const isMenuDisabled = !isWorkspaceReady || !permissions.canEdit

  const handleCreateWorkflow = useCallback(async () => {
    if (!workspaceId || isCreatingWorkflow) {
      return
    }

    setIsCreatingWorkflow(true)

    try {
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

  const createWorkflowDisabled = !isWorkspaceReady || isMenuDisabled || isCreatingWorkflow
  const createFolderDisabled = !isWorkspaceReady || isMenuDisabled || isCreatingFolder
  const importWorkflowDisabled = !isWorkspaceReady || isMenuDisabled || isImporting
  const createButtonTooltip = isWorkspaceReady
    ? 'Create folder or workflow'
    : 'Select a workspace to create workflows'

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className={widgetHeaderIconButtonClassName()}
                  disabled={isMenuDisabled}
                >
                  <Plus className={widgetHeaderMenuIconClassName} />
                  <span className='sr-only'>Create workflow</span>
                </button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>{createButtonTooltip}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-44')}
        >
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={createWorkflowDisabled}
            onSelect={() => {
              if (createWorkflowDisabled) return
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
            onSelect={() => {
              if (createFolderDisabled) return
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
            onSelect={() => {
              if (importWorkflowDisabled) return
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
