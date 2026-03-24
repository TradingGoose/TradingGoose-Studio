'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Wrench } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useCreateCustomTool,
  useCustomTools,
  useDeleteCustomTool,
  useUpdateCustomTool,
} from '@/hooks/queries/custom-tools'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import {
  emitCustomToolSelectionChange,
  useCustomToolSelectionPersistence,
} from '@/widgets/utils/custom-tool-selection'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { CustomToolListItem } from '@/widgets/widgets/custom_tool/components/custom-tool-list-item'
import {
  CUSTOM_TOOL_EDITOR_WIDGET_KEY,
  CUSTOM_TOOL_LIST_WIDGET_KEY,
  resolveCustomToolId,
} from '@/widgets/widgets/custom_tool/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'

const DEFAULT_CUSTOM_TOOL_NAME = 'newCustomTool'

const sortCustomTools = (tools: CustomToolDefinition[]) =>
  [...tools].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '')
    const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '')
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
  })

const buildNewCustomToolDraft = (tools: CustomToolDefinition[]) => {
  const existingNames = new Set(
    tools
      .map((tool) => tool.schema?.function?.name?.trim())
      .filter((name): name is string => Boolean(name))
  )

  let nextName = DEFAULT_CUSTOM_TOOL_NAME
  let suffix = 2

  while (existingNames.has(nextName)) {
    nextName = `${DEFAULT_CUSTOM_TOOL_NAME}${suffix}`
    suffix += 1
  }

  return {
    title: nextName,
    schema: {
      type: 'function',
      function: {
        name: nextName,
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
  onCreateCustomTool,
}: {
  disabled?: boolean
  onCreateCustomTool?: () => void
}) {
  const handleCreateCustomTool = useCallback(() => {
    onCreateCustomTool?.()
  }, [onCreateCustomTool])

  return (
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
                <span className='sr-only'>Create custom tool</span>
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>Create</TooltipContent>
      </Tooltip>
      <DropdownMenuContent sideOffset={6} className={cn(widgetHeaderMenuContentClassName, 'w-44')}>
        <DropdownMenuItem
          className={widgetHeaderMenuItemClassName}
          onSelect={handleCreateCustomTool}
        >
          <Plus className={widgetHeaderMenuIconClassName} />
          <span className={widgetHeaderMenuTextClassName}>New custom tool</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CustomToolListHeaderRight({
  workspaceId,
  panelId,
}: {
  workspaceId?: string | null
  panelId?: string
}) {
  const createMutation = useCreateCustomTool()
  const permissions = useUserPermissionsContext()
  const storedTools = useCustomToolsStore((state) =>
    workspaceId ? state.getAllTools(workspaceId) : []
  )

  const handleCreateTool = useCallback(async () => {
    if (!workspaceId || createMutation.isPending || !permissions.canEdit) return

    try {
      const createdTools = await createMutation.mutateAsync({
        workspaceId,
        tool: buildNewCustomToolDraft(storedTools),
      })
      const createdTool = Array.isArray(createdTools) ? createdTools[0] : null
      if (!createdTool?.id) return

      emitCustomToolSelectionChange({
        customToolId: createdTool.id,
        panelId,
        widgetKey: CUSTOM_TOOL_EDITOR_WIDGET_KEY,
      })
    } catch (error) {
      console.error('Failed to create custom tool', error)
    }
  }, [createMutation, panelId, permissions.canEdit, storedTools, workspaceId])

  return (
    <CustomToolCreateMenu
      disabled={!workspaceId || createMutation.isPending || !permissions.canEdit}
      onCreateCustomTool={handleCreateTool}
    />
  )
}

const ListCustomToolHeaderRight = ({
  workspaceId,
  panelId,
}: {
  workspaceId?: string | null
  panelId?: string
}) => {
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>Explorer</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <div className={widgetHeaderButtonGroupClassName()}>
        <CustomToolListHeaderRight workspaceId={workspaceId} panelId={panelId} />
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
        message={error instanceof Error ? error.message : 'Failed to load custom tools.'}
      />
    )
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {tools.length === 0 ? (
        <WidgetStateMessage message='No custom tools yet.' />
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
  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to browse custom tools.' />
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
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
  renderHeader: ({ context, panelId }) => ({
    right: <ListCustomToolHeaderRight workspaceId={context?.workspaceId} panelId={panelId} />,
  }),
}
