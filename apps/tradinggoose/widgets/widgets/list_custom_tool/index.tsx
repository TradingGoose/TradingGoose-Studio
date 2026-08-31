'use client'

import { type ChangeEvent, useCallback, useMemo, useRef } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Upload, Wrench } from 'lucide-react'
import { useMessages, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { parseImportedCustomToolsFile } from '@/lib/custom-tools/import-export'
import { generateAvailableName } from '@/lib/naming'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import { cn } from '@/lib/utils'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  createCustomTool,
  customToolsKeys,
  customToolWriteScope,
  deleteCustomTool,
  importCustomTools,
} from '@/hooks/queries/custom-tools'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { usePendingEntitySelection } from '@/widgets/utils/use-pending-entity-selection'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { CustomToolListItem } from '@/widgets/widgets/_shared/custom_tool/components/custom-tool-list-item'
import { resolveCustomToolId } from '@/widgets/widgets/_shared/custom_tool/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { customToolListWidgetContract } from '@/widgets/widgets/list_custom_tool/contract'

const DEFAULT_CUSTOM_TOOL_NAME = 'newCustomTool'

const sortCustomTools = (tools: CustomToolDefinition[]) =>
  [...tools].sort((a, b) => a.title.localeCompare(b.title))

const DEFAULT_CUSTOM_TOOL_SCHEMA = {
  type: 'function',
  function: {
    description: '',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

const buildNewCustomToolDraft = (title = DEFAULT_CUSTOM_TOOL_NAME) => {
  return {
    title,
    schema: DEFAULT_CUSTOM_TOOL_SCHEMA,
    code: '',
  }
}

type HeaderCustomToolWrite =
  | {
      kind: 'create'
      workspaceId: string
      tool: ReturnType<typeof buildNewCustomToolDraft>
    }
  | { kind: 'import'; workspaceId: string; file: File }

type BodyCustomToolWrite =
  | { kind: 'delete'; workspaceId: string; toolId: string }
  | { kind: 'rename'; workspaceId: string; toolId: string; title: string }

function CustomToolCreateMenu({
  disabled = false,
  pendingLabel,
  onCreateCustomTool,
  onImportCustomTools,
}: {
  disabled?: boolean
  pendingLabel?: string
  onCreateCustomTool?: () => void
  onImportCustomTools?: (file: File) => Promise<void> | void
}) {
  const t = useTranslations('workspace.widgets.customToolList.createMenu')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCreateCustomTool = useCallback(() => {
    onCreateCustomTool?.()
  }, [onCreateCustomTool])

  const handleImportSelection = useCallback(() => {
    if (disabled) return
    fileInputRef.current?.click()
  }, [disabled])

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        await onImportCustomTools?.(file)
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [onImportCustomTools]
  )

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className='inline-flex'>
                <DropdownMenuTrigger
                  render={
                    <button
                      type='button'
                      disabled={disabled}
                      aria-busy={pendingLabel ? 'true' : undefined}
                      className={widgetHeaderIconButtonClassName()}
                    />
                  }
                >
                  {pendingLabel ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <Plus className='h-4 w-4' />
                  )}
                  <span className='sr-only'>{pendingLabel ?? t('createCustomTool')}</span>
                </DropdownMenuTrigger>
              </span>
            }
          />
          <TooltipContent side='top'>{pendingLabel ?? t('create')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-48')}
        >
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              handleImportSelection()
            }}
          >
            <Upload className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>{t('importCustomTools')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              handleCreateCustomTool()
            }}
          >
            <Plus className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>{t('newCustomTool')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {pendingLabel ? (
        <span className='text-muted-foreground text-xs' role='status'>
          {pendingLabel}
        </span>
      ) : null}

      <input
        ref={fileInputRef}
        type='file'
        accept='.json,application/json'
        className='hidden'
        onChange={handleFileChange}
      />
    </>
  )
}

function CustomToolListHeaderRight({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('workspace.widgets.customToolList.createMenu')
  const permissions = useUserPermissionsContext()
  const queryClient = useQueryClient()
  const writeLockRef = useRef(false)
  const mutationKey = customToolsKeys.write(workspaceId)
  const activeWriteCount = useIsMutating({ mutationKey, exact: true })
  const actions = useWidgetConfigRuntimeActions()
  const { members } = useEntityList('custom_tool', workspaceId)

  const selectTool = useCallback(
    (createdToolId: string) => {
      actions.patchWidgetLinkedParams?.({ customToolId: createdToolId })
    },
    [actions]
  )
  const selectToolWhenListed = usePendingEntitySelection(members, selectTool)

  const writeMutation = useMutation({
    mutationKey,
    scope: { id: customToolWriteScope(workspaceId) },
    mutationFn: async (operation: HeaderCustomToolWrite) => {
      if (operation.kind === 'create') {
        return createCustomTool(operation)
      }
      const content = await operation.file.text()
      const file = parseImportedCustomToolsFile(JSON.parse(content) as unknown)
      await importCustomTools({ workspaceId: operation.workspaceId, file })
      return null
    },
    onSuccess: async (createdTools, operation) => {
      await queryClient.invalidateQueries({
        queryKey: customToolsKeys.list(operation.workspaceId),
      })
      if (operation.kind === 'create') {
        const createdTool = createdTools?.[0]
        const createdToolId =
          createdTool && typeof createdTool.id === 'string' ? createdTool.id : null
        if (!createdToolId) {
          throw new Error('Created custom tool is missing an id')
        }
        selectToolWhenListed(createdToolId)
      }
    },
    onError: (error, operation) => {
      console.error(`Failed to ${operation.kind} custom tools`, error)
      toast.error(operation.kind === 'create' ? t('createFailed') : t('importFailed'))
    },
  })

  const runWrite = useCallback(
    async (operation: HeaderCustomToolWrite) => {
      if (writeLockRef.current || activeWriteCount > 0 || !permissions.canEdit) return
      writeLockRef.current = true
      try {
        await writeMutation.mutateAsync(operation)
      } catch {
        // The mutation owns error logging and user feedback.
      } finally {
        writeLockRef.current = false
      }
    },
    [activeWriteCount, permissions.canEdit, writeMutation]
  )

  const handleCreateTool = useCallback(() => {
    const tool = buildNewCustomToolDraft(
      generateAvailableName(
        members.map((member) => member.entityName),
        DEFAULT_CUSTOM_TOOL_NAME
      )
    )
    void runWrite({ kind: 'create', workspaceId, tool })
  }, [members, runWrite, workspaceId])

  const pendingLabel =
    writeMutation.isPending && writeMutation.variables?.kind === 'create'
      ? t('creatingCustomTool')
      : writeMutation.isPending
        ? t('importingCustomTools')
        : undefined

  return (
    <CustomToolCreateMenu
      disabled={!permissions.canEdit || activeWriteCount > 0}
      pendingLabel={pendingLabel}
      onCreateCustomTool={handleCreateTool}
      onImportCustomTools={(file) => runWrite({ kind: 'import', workspaceId, file })}
    />
  )
}

const ListCustomToolHeaderRight = ({ workspaceId }: { workspaceId?: string | null }) => {
  const copy = useMessages().workspace.widgets.customToolList.header
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <div className={widgetHeaderButtonGroupClassName()}>
        <CustomToolListHeaderRight workspaceId={workspaceId} />
      </div>
    </WorkspacePermissionsProvider>
  )
}

function ListCustomToolWidgetBodyInner({
  context,
  params,
  onWidgetLinkedParamsPatch,
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? ''
  const copy = useMessages().workspace.widgets.customToolList.body
  const permissions = useUserPermissionsContext()
  const queryClient = useQueryClient()
  const writeLockRef = useRef(false)
  const mutationKey = customToolsKeys.write(workspaceId)
  const activeWriteCount = useIsMutating({ mutationKey, exact: true })
  const { members, isLoading, isRetrying, error, retry } = useEntityList('custom_tool', workspaceId)

  const tools = useMemo(
    () =>
      sortCustomTools(
        workspaceId
          ? members.map((member) => ({
              id: member.entityId,
              workspaceId,
              userId: null,
              title: member.entityName,
              schema: DEFAULT_CUSTOM_TOOL_SCHEMA,
              code: '',
            }))
          : []
      ),
    [members, workspaceId]
  )

  const requestedToolId = resolveCustomToolId({
    params,
  })
  const selectedToolId = resolveEntityIdFromList({
    requestedEntityId: requestedToolId,
    entityIds: tools.map((tool) => tool.id),
    useDefaultEntity: false,
  })
  const syncSelection = useCallback(
    (customToolId: string | null) => {
      onWidgetLinkedParamsPatch?.({ customToolId })
    },
    [onWidgetLinkedParamsPatch]
  )

  const writeMutation = useMutation({
    mutationKey,
    scope: { id: customToolWriteScope(workspaceId) },
    mutationFn: async (operation: BodyCustomToolWrite) => {
      if (operation.kind === 'delete') {
        await deleteCustomTool(operation)
        return
      }
      await renameSavedEntityAction({
        entityKind: 'custom_tool',
        entityId: operation.toolId,
        workspaceId: operation.workspaceId,
        name: operation.title,
      })
    },
    onSuccess: async (_result, operation) => {
      await queryClient.invalidateQueries({
        queryKey: customToolsKeys.list(operation.workspaceId),
      })
      if (operation.kind === 'delete' && selectedToolId === operation.toolId) {
        syncSelection(null)
      }
    },
  })

  const runWrite = useCallback(
    async (operation: BodyCustomToolWrite): Promise<boolean> => {
      if (writeLockRef.current || activeWriteCount > 0 || !permissions.canEdit) return false
      writeLockRef.current = true
      try {
        await writeMutation.mutateAsync(operation)
        return true
      } finally {
        writeLockRef.current = false
      }
    },
    [activeWriteCount, permissions.canEdit, writeMutation]
  )

  const handleDeleteTool = useCallback(
    (customToolId: string) => runWrite({ kind: 'delete', workspaceId, toolId: customToolId }),
    [runWrite, workspaceId]
  )

  const handleRenameTool = useCallback(
    (customToolId: string, title: string) =>
      runWrite({ kind: 'rename', workspaceId, toolId: customToolId, title }),
    [runWrite, workspaceId]
  )

  if (isLoading && tools.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (error && tools.length === 0) {
    return (
      <WidgetStateMessage
        message={copy.failedToLoadCustomTools}
        variant='error'
        onRetry={retry}
        isRetrying={isRetrying}
      />
    )
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {tools.length === 0 ? (
        <WidgetStateMessage message={copy.noCustomToolsYet} />
      ) : (
        <div className='h-full space-y-1 overflow-auto'>
          {tools.map((tool) => (
            <CustomToolListItem
              key={tool.id}
              tool={tool}
              isSelected={tool.id === selectedToolId}
              onSelect={syncSelection}
              onDelete={handleDeleteTool}
              onRename={handleRenameTool}
              canEdit={permissions.canEdit}
              canDelete={tools.length > 1}
              writesDisabled={activeWriteCount > 0}
              isDeleting={
                writeMutation.isPending &&
                writeMutation.variables?.kind === 'delete' &&
                writeMutation.variables.toolId === tool.id
              }
              isRenaming={
                writeMutation.isPending &&
                writeMutation.variables?.kind === 'rename' &&
                writeMutation.variables.toolId === tool.id
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ListCustomToolWidgetBody = (props: WidgetComponentProps) => {
  const workspaceId = props.context?.workspaceId ?? null
  const copy = useMessages().workspace.widgets.customToolList.body
  if (!workspaceId) {
    return <WidgetStateMessage message={copy.selectWorkspace} />
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <ListCustomToolWidgetBodyInner {...props} />
    </WorkspacePermissionsProvider>
  )
}

export const listCustomToolWidget: DashboardWidgetDefinition = {
  contract: customToolListWidgetContract,
  icon: Wrench,
  component: (props) => <ListCustomToolWidgetBody {...props} />,
  renderHeader: ({ context }) => ({
    right: <ListCustomToolHeaderRight workspaceId={context?.workspaceId} />,
  }),
}
