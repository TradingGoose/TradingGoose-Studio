'use client'

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Upload, Wrench } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
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
import { cn } from '@/lib/utils'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useCreateCustomTool,
  useCustomTools,
  useDeleteCustomTool,
  useImportCustomTools,
  useUpdateCustomTool,
} from '@/hooks/queries/custom-tools'
import type { LocaleCode } from '@/i18n/utils'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import {
  emitCustomToolSelectionChange,
  useCustomToolSelectionPersistence,
} from '@/widgets/utils/custom-tool-selection'
import { CustomToolListItem } from '@/widgets/widgets/_shared/custom_tool/components/custom-tool-list-item'
import {
  CUSTOM_TOOL_EDITOR_WIDGET_KEY,
  CUSTOM_TOOL_LIST_WIDGET_KEY,
  resolveCustomToolId,
} from '@/widgets/widgets/_shared/custom_tool/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'

const DEFAULT_CUSTOM_TOOL_NAME = 'newCustomTool'

const sortCustomTools = (tools: CustomToolDefinition[]) =>
  [...tools].sort((a, b) => a.title.localeCompare(b.title))

const buildNewCustomToolDraft = (tools: CustomToolDefinition[]) => {
  const existingTitles = new Set(
    tools.map((tool) => tool.title.trim()).filter((title): title is string => Boolean(title))
  )

  let nextTitle = DEFAULT_CUSTOM_TOOL_NAME
  let suffix = 2

  while (existingTitles.has(nextTitle)) {
    nextTitle = `${DEFAULT_CUSTOM_TOOL_NAME}${suffix}`
    suffix += 1
  }

  return {
    title: nextTitle,
    schema: {
      type: 'function',
      function: {
        description: '',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    code: '',
  }
}

function CustomToolCreateMenu({
  disabled = false,
  canCreate = false,
  canImport = false,
  isImporting = false,
  onCreateCustomTool,
  onImportCustomTools,
}: {
  disabled?: boolean
  canCreate?: boolean
  canImport?: boolean
  isImporting?: boolean
  onCreateCustomTool?: () => void
  onImportCustomTools?: (content: string, filename?: string) => Promise<void> | void
}) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.customToolList.createMenu
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCreateCustomTool = useCallback(() => {
    onCreateCustomTool?.()
  }, [onCreateCustomTool])

  const handleImportSelection = useCallback(() => {
    if (!canImport || isImporting) return
    fileInputRef.current?.click()
  }, [canImport, isImporting])

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const content = await file.text()
        await onImportCustomTools?.(content, file.name)
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
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  disabled={disabled}
                  className={widgetHeaderIconButtonClassName()}
                >
                  <Plus className='h-4 w-4' />
                  <span className='sr-only'>{copy.createCustomTool}</span>
                </button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>{copy.create}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-48')}
        >
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={!canImport || isImporting}
            onSelect={() => {
              if (!canImport || isImporting) return
              handleImportSelection()
            }}
          >
            <Upload className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {isImporting ? copy.importingCustomTools : copy.importCustomTools}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={!canCreate}
            onSelect={() => {
              if (!canCreate) return
              handleCreateCustomTool()
            }}
          >
            <Plus className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>{copy.newCustomTool}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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

function CustomToolListHeaderRight({
  workspaceId,
  panelId,
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) {
  const permissions = useUserPermissionsContext()
  const createToolMutation = useCreateCustomTool()
  const importMutation = useImportCustomTools()
  const storedTools = useCustomToolsStore((state) =>
    workspaceId ? state.getAllTools(workspaceId) : []
  )
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const handleCreateTool = useCallback(() => {
    if (!workspaceId || !permissions.canEdit) return

    void createToolMutation
      .mutateAsync({
        workspaceId,
        tool: buildNewCustomToolDraft(storedTools),
      })
      .then((createdTools) => {
        const createdTool = createdTools[0]
        const createdToolId =
          createdTool && typeof createdTool.id === 'string' ? createdTool.id : null

        if (!createdToolId) {
          throw new Error('Created custom tool is missing an id')
        }

        if (isLinkedToColorPair) {
          setPairContext(resolvedPairColor, { customToolId: createdToolId })
          return
        }

        emitCustomToolSelectionChange({
          customToolId: createdToolId,
          panelId,
          widgetKey: CUSTOM_TOOL_LIST_WIDGET_KEY,
        })
        emitCustomToolSelectionChange({
          customToolId: createdToolId,
          panelId,
          widgetKey: CUSTOM_TOOL_EDITOR_WIDGET_KEY,
        })
      })
      .catch((error) => {
        console.error('Failed to create custom tool from list widget', error)
      })
  }, [
    createToolMutation,
    isLinkedToColorPair,
    panelId,
    permissions.canEdit,
    resolvedPairColor,
    setPairContext,
    storedTools,
    workspaceId,
  ])

  const handleImportCustomTools = useCallback(
    async (content: string) => {
      if (!workspaceId || importMutation.isPending || !permissions.canEdit) return

      try {
        const parsedFile = parseImportedCustomToolsFile(JSON.parse(content) as unknown)
        await importMutation.mutateAsync({
          workspaceId,
          file: parsedFile,
        })
      } catch (error) {
        console.error('Failed to import custom tools', error)
      }
    },
    [importMutation, permissions.canEdit, workspaceId]
  )

  return (
    <CustomToolCreateMenu
      disabled={!workspaceId || !permissions.canEdit || createToolMutation.isPending}
      canCreate={!createToolMutation.isPending && permissions.canEdit}
      canImport={Boolean(workspaceId && permissions.canEdit)}
      isImporting={importMutation.isPending}
      onCreateCustomTool={handleCreateTool}
      onImportCustomTools={handleImportCustomTools}
    />
  )
}

const ListCustomToolHeaderRight = ({
  workspaceId,
  panelId,
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) => {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.customToolList.header
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <div className={widgetHeaderButtonGroupClassName()}>
        <CustomToolListHeaderRight
          workspaceId={workspaceId}
          panelId={panelId}
          pairColor={pairColor}
        />
      </div>
    </WorkspacePermissionsProvider>
  )
}

function ListCustomToolWidgetBodyInner({
  context,
  params,
  pairColor = 'gray',
  onWidgetParamsChange,
  panelId,
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.customToolList.body
  const permissions = useUserPermissionsContext()
  const { data: queryTools = [], isLoading, error } = useCustomTools(workspaceId ?? '')
  const storedTools = useCustomToolsStore((state) =>
    workspaceId ? state.getAllTools(workspaceId) : []
  )
  const deleteToolMutation = useDeleteCustomTool()
  const updateToolMutation = useUpdateCustomTool()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const [deletingToolIds, setDeletingToolIds] = useState<Set<string>>(new Set())

  const tools = useMemo(
    () => sortCustomTools(queryTools.length > 0 ? queryTools : storedTools),
    [queryTools, storedTools]
  )

  const selectedToolId = useMemo(() => {
    if (isLinkedToColorPair) {
      return resolveCustomToolId({ pairContext, params })
    }

    return resolveCustomToolId({ params })
  }, [isLinkedToColorPair, pairContext, params])

  useCustomToolSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    scopeKey: CUSTOM_TOOL_LIST_WIDGET_KEY,
    onCustomToolSelect: (customToolId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.customToolId === customToolId) return
      setPairContext(resolvedPairColor, { customToolId })
    },
  })

  const syncSelection = useCallback(
    (customToolId: string | null) => {
      if (isLinkedToColorPair) {
        if (pairContext?.customToolId !== customToolId) {
          setPairContext(resolvedPairColor, { customToolId })
        }
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange?.({
        ...currentParams,
        customToolId,
      })
      emitCustomToolSelectionChange({
        customToolId,
        panelId,
        widgetKey: CUSTOM_TOOL_EDITOR_WIDGET_KEY,
      })
    },
    [
      isLinkedToColorPair,
      onWidgetParamsChange,
      pairContext?.customToolId,
      panelId,
      params,
      resolvedPairColor,
      setPairContext,
    ]
  )

  useEffect(() => {
    if (!selectedToolId) {
      return
    }

    if (tools.some((tool) => tool.id === selectedToolId)) {
      return
    }

    syncSelection(null)
  }, [selectedToolId, syncSelection, tools])

  const handleDeleteTool = useCallback(
    async (customToolId: string) => {
      if (!workspaceId || !permissions.canEdit) return
      if (!customToolId) return

      setDeletingToolIds((prev) => new Set(prev).add(customToolId))

      try {
        await deleteToolMutation.mutateAsync({ workspaceId, toolId: customToolId })
        if (selectedToolId === customToolId) {
          syncSelection(null)
        }
      } finally {
        setDeletingToolIds((prev) => {
          const next = new Set(prev)
          next.delete(customToolId)
          return next
        })
      }
    },
    [deleteToolMutation, permissions.canEdit, selectedToolId, syncSelection, workspaceId]
  )

  const handleRenameTool = useCallback(
    async (customToolId: string, title: string) => {
      if (!workspaceId || !permissions.canEdit) return

      await updateToolMutation.mutateAsync({
        workspaceId,
        toolId: customToolId,
        updates: {
          title,
        },
      })
    },
    [permissions.canEdit, updateToolMutation, workspaceId]
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
        message={error instanceof Error ? error.message : copy.failedToLoadCustomTools}
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
              isDeleting={deletingToolIds.has(tool.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ListCustomToolWidgetBody = (props: WidgetComponentProps) => {
  const workspaceId = props.context?.workspaceId ?? null
  const locale = useLocale() as LocaleCode
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
  key: CUSTOM_TOOL_LIST_WIDGET_KEY,
  title: 'Custom Tool List',
  icon: Wrench,
  category: 'list',
  description: 'Browse and manage workspace custom tools.',
  component: (props) => <ListCustomToolWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => ({
    right: (
      <ListCustomToolHeaderRight
        workspaceId={context?.workspaceId}
        panelId={panelId}
        pairColor={widget?.pairColor}
      />
    ),
  }),
}
