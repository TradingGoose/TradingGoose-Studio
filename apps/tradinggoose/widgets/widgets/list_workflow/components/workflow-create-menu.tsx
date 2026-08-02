'use client'

import { useCallback, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Folder, Plus } from 'lucide-react'
import { useMessages } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { createLogger } from '@/lib/logs/console/logger'
import { generateIncrementalName } from '@/lib/naming'
import { cn } from '@/lib/utils'
import { importParsedWorkflow } from '@/lib/workflows/import'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { importSkills } from '@/hooks/queries/skills'
import { formatTemplate } from '@/i18n/utils'
import { useFolderStore } from '@/stores/folders/store'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { buildImportedWorkflowSkillsLookup } from './workflow-create-menu.utils'

const logger = createLogger('DashboardWorkflowCreateMenu')
type WorkflowMenuAction = 'create-workflow' | 'create-folder' | 'import-workflow'

export interface DashboardWorkflowCreateMenuProps {
  workspaceId?: string | null
  existingWorkflowNames: string[]
  onWorkflowCreated?: (workflowId: string) => void
  ownerId: string
}

export function DashboardWorkflowCreateMenu({
  workspaceId,
  existingWorkflowNames,
  onWorkflowCreated,
  ownerId,
}: DashboardWorkflowCreateMenuProps) {
  const [activeAction, setActiveAction] = useState<WorkflowMenuAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const actionFeedbackId = useId()
  const actionLockRef = useRef(false)
  const copy = useMessages().workspace.widgets.workflowCreateMenu
  const queryClient = useQueryClient()
  const permissions = useUserPermissionsContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeFolderWrite = useFolderStore((state) => state.activeWrite)
  const folderDataReady = useFolderStore((state) =>
    workspaceId ? state.folderDataReady[workspaceId] === true : false
  )
  const writeFolder = useFolderStore((state) => state.writeFolder)
  const createWorkflow = useWorkflowRegistry((state) => state.createWorkflow)
  const isWorkspaceReady = Boolean(workspaceId)
  const isFolderWritePending = Boolean(activeFolderWrite)
  const isMenuDisabled = !isWorkspaceReady || !permissions.canEdit
  const isActionPending = activeAction !== null
  const beginAction = useCallback((action: WorkflowMenuAction) => {
    if (actionLockRef.current) return false
    actionLockRef.current = true
    setActiveAction(action)
    setActionError(null)
    return true
  }, [])
  const finishAction = useCallback(() => {
    actionLockRef.current = false
    setActiveAction(null)
  }, [])

  const handleCreateWorkflow = useCallback(async () => {
    if (!workspaceId || !beginAction('create-workflow')) return
    try {
      const workflowId = await createWorkflow({ workspaceId })
      if (workflowId) onWorkflowCreated?.(workflowId)
    } catch (error) {
      logger.error('Failed to create workflow from dashboard widget:', { error })
      setActionError(copy.createFailed)
    } finally {
      finishAction()
    }
  }, [beginAction, copy.createFailed, createWorkflow, finishAction, onWorkflowCreated, workspaceId])

  const handleCreateFolder = useCallback(async () => {
    const folderState = useFolderStore.getState()
    if (
      !workspaceId ||
      folderState.activeWrite ||
      folderState.folderDataReady[workspaceId] !== true
    ) {
      return
    }
    if (!beginAction('create-folder')) return

    try {
      const rootFolders = Object.values(folderState.folders).filter(
        (folder) => folder.workspaceId === workspaceId && folder.parentId === null
      )
      const folderName = generateIncrementalName(rootFolders, 'Folder')
      await writeFolder({ kind: 'create', workspaceId, ownerId, name: folderName }, queryClient)
      logger.info(`Created folder ${folderName} from dashboard widget`)
    } catch (error) {
      logger.error('Failed to create folder from dashboard widget:', { error })
    } finally {
      finishAction()
    }
  }, [beginAction, finishAction, ownerId, queryClient, workspaceId, writeFolder])

  const handleImportWorkflow = useCallback(() => {
    if (!workspaceId || isActionPending) return
    fileInputRef.current?.click()
  }, [isActionPending, workspaceId])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file || !workspaceId || !beginAction('import-workflow')) return
      let importedCount = 0

      try {
        const content = await file.text()
        if (!content.trim()) {
          setActionError(copy.emptyImportFile)
          return
        }

        const parsedWorkflow = parseWorkflowJson(content, true)
        if (!parsedWorkflow.data || parsedWorkflow.errors.length > 0) {
          setActionError(parsedWorkflow.errors[0] ?? copy.importFailed)
          return
        }

        let importedSkillsBySourceName:
          | ReturnType<typeof buildImportedWorkflowSkillsLookup>
          | undefined

        if (parsedWorkflow.data.skills.length > 0) {
          const importResult = await importSkills({
            workspaceId,
            file: JSON.parse(content) as unknown,
          })
          importedCount = importResult.import.addedCount

          importedSkillsBySourceName = buildImportedWorkflowSkillsLookup({
            expectedSkills: parsedWorkflow.data.skills,
            importedSkills: importResult.importedSkills,
          })
        }

        const newWorkflowId = await importParsedWorkflow({
          workflowData: parsedWorkflow.data,
          workspaceId,
          existingWorkflowNames,
          importedSkillsBySourceName,
          createWorkflow,
        })

        logger.info('Workflow imported successfully from dashboard widget')
        onWorkflowCreated?.(newWorkflowId)
      } catch (error) {
        logger.error('Failed to import workflow from dashboard widget:', { error })
        setActionError(
          importedCount > 0
            ? formatTemplate(copy.importPartialFailed, { count: importedCount })
            : copy.importFailed
        )
      } finally {
        finishAction()
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [
      beginAction,
      copy.emptyImportFile,
      copy.importFailed,
      copy.importPartialFailed,
      createWorkflow,
      existingWorkflowNames,
      finishAction,
      onWorkflowCreated,
      workspaceId,
    ]
  )

  const createWorkflowDisabled = isMenuDisabled || isActionPending
  const createFolderDisabled =
    isMenuDisabled || isActionPending || isFolderWritePending || !folderDataReady
  const importWorkflowDisabled = isMenuDisabled || isActionPending
  const createButtonTooltip = isWorkspaceReady
    ? copy.createButtonTooltip
    : copy.selectWorkspaceTooltip

  return (
    <div className='relative inline-flex'>
      <DropdownMenu
        onOpenChange={(_open, eventDetails) => {
          if (isActionPending) eventDetails.cancel()
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <span className='inline-flex'>
                <DropdownMenuTrigger
                  disabled={isMenuDisabled}
                  render={
                    <button
                      type='button'
                      className={widgetHeaderIconButtonClassName()}
                      disabled={isMenuDisabled}
                      aria-disabled={isActionPending || undefined}
                      aria-busy={isActionPending || undefined}
                      aria-describedby={
                        activeAction !== 'create-folder' && (isActionPending || actionError)
                          ? actionFeedbackId
                          : undefined
                      }
                    />
                  }
                >
                  <Plus className={widgetHeaderMenuIconClassName} />
                  <span className='sr-only'>{copy.createWorkflow}</span>
                </DropdownMenuTrigger>
              </span>
            }
          />
          <TooltipContent side='top'>{createButtonTooltip}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-44')}
        >
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={createWorkflowDisabled}
            onClick={() => {
              if (createWorkflowDisabled) return
              void handleCreateWorkflow()
            }}
          >
            <Plus className={widgetHeaderMenuTextClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {activeAction === 'create-workflow' ? copy.creating : copy.createWorkflow}
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={createFolderDisabled}
            onClick={() => {
              if (createFolderDisabled) return
              void handleCreateFolder()
            }}
          >
            <Folder className={widgetHeaderMenuTextClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {activeAction === 'create-folder' ? copy.creatingFolder : copy.createFolder}
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={importWorkflowDisabled}
            onClick={() => {
              if (importWorkflowDisabled) return
              handleImportWorkflow()
            }}
          >
            <Download className={widgetHeaderMenuTextClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {activeAction === 'import-workflow' ? copy.importing : copy.importWorkflow}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {activeAction && activeAction !== 'create-folder' ? (
        <p
          id={actionFeedbackId}
          role='status'
          aria-atomic='true'
          className='absolute top-full right-0 z-50 mt-1 w-64 rounded-md border bg-popover p-2 text-popover-foreground text-xs shadow-md'
        >
          {activeAction === 'create-workflow' ? copy.creating : copy.importing}
        </p>
      ) : !activeAction && actionError ? (
        <p
          id={actionFeedbackId}
          role='alert'
          aria-atomic='true'
          className='absolute top-full right-0 z-50 mt-1 w-64 rounded-md border border-destructive/30 bg-popover p-2 text-destructive text-xs shadow-md'
        >
          {actionError}
        </p>
      ) : null}

      <input
        ref={fileInputRef}
        type='file'
        accept='.json'
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}
