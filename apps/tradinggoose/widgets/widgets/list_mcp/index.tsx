'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Server, Trash2 } from 'lucide-react'
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
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitMcpSelectionChange, useMcpSelectionPersistence } from '@/widgets/utils/mcp-selection'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { resolveMcpServerId } from '@/widgets/widgets/_shared/mcp/utils'

const DEFAULT_MCP_SERVER = {
  name: 'New MCP Server',
  transport: 'streamable-http' as const,
  url: '',
  timeout: 30000,
  headers: {},
  enabled: true,
}

const WidgetMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const getServerName = (server: McpServerWithStatus) => server.name || 'Unnamed server'

const getServerIconColor = (status?: McpServerWithStatus['connectionStatus']) => {
  if (status === 'connected') {
    return '#10b981'
  }

  if (status === 'error') {
    return '#ef4444'
  }

  return '#64748b'
}

const McpCreateMenu = ({
  disabled = false,
  onCreateServer,
}: {
  disabled?: boolean
  onCreateServer?: () => void
}) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <DropdownMenuTrigger asChild>
            <button type='button' disabled={disabled} className={widgetHeaderIconButtonClassName()}>
              <Plus className='h-4 w-4' />
              <span className='sr-only'>Create MCP server</span>
            </button>
          </DropdownMenuTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>Create</TooltipContent>
    </Tooltip>
    <DropdownMenuContent sideOffset={6} className={cn(widgetHeaderMenuContentClassName, 'w-44')}>
      <DropdownMenuItem className={widgetHeaderMenuItemClassName} onSelect={onCreateServer}>
        <Plus className={widgetHeaderMenuIconClassName} />
        <span className={widgetHeaderMenuTextClassName}>New MCP server</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)

const ListMcpHeaderRightContent = ({
  workspaceId,
  panelId,
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) => {
  const permissions = useUserPermissionsContext()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const { createServer, isLoading } = useMcpServersStore(
    (state) => ({
      createServer: state.createServer,
      isLoading: state.isLoading,
    }),
    shallow
  )

  const handleCreateServer = useCallback(async () => {
    if (!workspaceId || !permissions.canEdit || isLoading) return

    try {
      const created = await createServer(workspaceId, DEFAULT_MCP_SERVER)
      if (!created?.id) return

      if (isLinkedToColorPair) {
        setPairContext(resolvedPairColor, { mcpServerId: created.id })
        return
      }

      emitMcpSelectionChange({
        serverId: created.id,
        panelId,
        widgetKey: 'list_mcp',
      })
      emitMcpSelectionChange({
        serverId: created.id,
        panelId,
        widgetKey: 'editor_mcp',
      })
    } catch (error) {
      console.error('Failed to create MCP server', error)
    }
  }, [
    createServer,
    isLinkedToColorPair,
    isLoading,
    panelId,
    permissions.canEdit,
    resolvedPairColor,
    setPairContext,
    workspaceId,
  ])

  return (
    <McpCreateMenu
      disabled={!workspaceId || !permissions.canEdit || isLoading}
      onCreateServer={handleCreateServer}
    />
  )
}

const ListMcpHeaderRight = ({
  workspaceId,
  panelId,
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) => {
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>Explorer</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <div className={widgetHeaderButtonGroupClassName()}>
        <ListMcpHeaderRightContent
          workspaceId={workspaceId}
          panelId={panelId}
          pairColor={pairColor}
        />
      </div>
    </WorkspacePermissionsProvider>
  )
}

const ListMcpWidgetContent = ({
  context,
  params,
  pairColor = 'gray',
  onWidgetParamsChange,
  panelId,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [hasRequestedLoad, setHasRequestedLoad] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { servers, isLoading, error, fetchServers, deleteServer, updateServer } =
    useMcpServersStore(
      (state) => ({
        servers: state.servers,
        isLoading: state.isLoading,
        error: state.error,
        fetchServers: state.fetchServers,
        deleteServer: state.deleteServer,
        updateServer: state.updateServer,
      }),
      shallow
    )
  const { refreshTools } = useMcpTools(workspaceId ?? '')
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const workspaceServers = useMemo(
    () =>
      workspaceId
        ? servers
            .filter((server) => server.workspaceId === workspaceId && !server.deletedAt)
            .sort((a, b) => {
              const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '')
              const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '')
              return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
            })
        : [],
    [servers, workspaceId]
  )

  const selectedServerId = resolveMcpServerId({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
  })
  const selectedServer = selectedServerId
    ? (workspaceServers.find((server) => server.id === selectedServerId) ?? null)
    : null

  useEffect(() => {
    if (!workspaceId || workspaceServers.length > 0) {
      return
    }

    setHasRequestedLoad(true)
    fetchServers(workspaceId).catch((fetchError) => {
      console.error('Failed to load MCP servers for list widget', fetchError)
    })
  }, [fetchServers, workspaceId, workspaceServers.length])

  useMcpSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    scopeKey: 'list_mcp',
    onServerSelect: (serverId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.mcpServerId === serverId) return
      setPairContext(resolvedPairColor, { mcpServerId: serverId })
    },
  })

  useEffect(() => {
    if (!selectedServerId || selectedServer || !hasRequestedLoad) {
      return
    }

    const currentParams =
      params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

    if (isLinkedToColorPair) {
      if (pairContext?.mcpServerId !== null) {
        setPairContext(resolvedPairColor, { mcpServerId: null })
      }
      return
    }

    onWidgetParamsChange?.({
      ...currentParams,
      mcpServerId: null,
    })
    emitMcpSelectionChange({
      serverId: null,
      panelId,
      widgetKey: 'editor_mcp',
    })
  }, [
    hasRequestedLoad,
    isLinkedToColorPair,
    onWidgetParamsChange,
    panelId,
    pairContext?.mcpServerId,
    params,
    resolvedPairColor,
    selectedServer,
    selectedServerId,
    setPairContext,
  ])

  const handleSelectServer = useCallback(
    (serverId: string | null) => {
      if (isLinkedToColorPair) {
        if (pairContext?.mcpServerId !== serverId) {
          setPairContext(resolvedPairColor, { mcpServerId: serverId })
        }
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange?.({
        ...currentParams,
        mcpServerId: serverId,
      })

      emitMcpSelectionChange({
        serverId,
        panelId,
        widgetKey: 'editor_mcp',
      })
    },
    [
      isLinkedToColorPair,
      onWidgetParamsChange,
      panelId,
      pairContext?.mcpServerId,
      params,
      resolvedPairColor,
      setPairContext,
    ]
  )

  const handleRenameServer = useCallback(
    async (serverId: string, name: string) => {
      if (!workspaceId || !permissions.canEdit) return

      await updateServer(workspaceId, serverId, {
        name,
      })
    },
    [permissions.canEdit, updateServer, workspaceId]
  )

  const handleDeleteServer = useCallback(
    async (serverId: string) => {
      if (!workspaceId || !permissions.canEdit) return
      if (deletingIds.has(serverId)) return

      setDeletingIds((prev) => new Set(prev).add(serverId))
      try {
        await deleteServer(workspaceId, serverId)
        await refreshTools(true)
        if (selectedServerId === serverId) {
          handleSelectServer(null)
        }
      } catch (deleteError) {
        console.error('Failed to delete MCP server', deleteError)
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev)
          next.delete(serverId)
          return next
        })
      }
    },
    [
      deleteServer,
      deletingIds,
      handleSelectServer,
      permissions.canEdit,
      refreshTools,
      selectedServerId,
      workspaceId,
    ]
  )

  useEffect(() => {
    setHasRequestedLoad(false)
  }, [workspaceId])

  if (!workspaceId) {
    return <WidgetMessage message='Select a workspace to browse MCP servers.' />
  }

  if (error && workspaceServers.length === 0) {
    return <WidgetMessage message={error || 'Failed to load MCP servers.'} />
  }

  if ((isLoading || !hasRequestedLoad) && workspaceServers.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {workspaceServers.length === 0 ? (
        <WidgetMessage message='No MCP servers yet.' />
      ) : (
        <div className='h-full space-y-1 overflow-auto'>
          {workspaceServers.map((server) => (
            <McpServerListItem
              key={server.id}
              server={server}
              isSelected={server.id === selectedServerId}
              onSelect={handleSelectServer}
              onRename={handleRenameServer}
              onDelete={handleDeleteServer}
              canEdit={permissions.canEdit}
              isDeleting={deletingIds.has(server.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const McpServerListItem = ({
  server,
  isSelected,
  onSelect,
  onRename,
  onDelete,
  canEdit,
  isDeleting,
}: {
  server: McpServerWithStatus
  isSelected: boolean
  onSelect: (serverId: string | null) => void
  onRename: (serverId: string, name: string) => Promise<void>
  onDelete: (serverId: string) => void | Promise<void>
  canEdit: boolean
  isDeleting: boolean
}) => {
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(server.name ?? '')
  const [isRenaming, setIsRenaming] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayName = getServerName(server)
  const iconColor = getServerIconColor(server.connectionStatus)

  useEffect(() => {
    setEditValue(server.name ?? '')
  }, [server.name])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    if (!canEdit) return
    setIsEditing(true)
    setEditValue(server.name ?? '')
  }

  const handleSaveEdit = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === server.name) {
      setIsEditing(false)
      setEditValue(server.name ?? '')
      return
    }

    setIsRenaming(true)
    try {
      await onRename(server.id, trimmed)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to rename MCP server', error)
      setEditValue(server.name ?? '')
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditValue(server.name ?? '')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleSaveEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEdit()
    }
  }

  const handleInputBlur = () => {
    void handleSaveEdit()
  }

  const handleConfirmDelete = useCallback(async () => {
    try {
      await Promise.resolve(onDelete(server.id))
      setShowDeleteDialog(false)
    } catch (error) {
      console.error('Failed to delete MCP server', error)
    }
  }, [onDelete, server.id])

  return (
    <div className='mb-1'>
      <div
        className={cn(
          'group flex h-8 cursor-pointer items-center rounded-sm px-2 py-2 font-medium font-sans text-sm transition-colors',
          isSelected ? 'bg-secondary/60' : 'hover:bg-secondary/30'
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left'
          disabled={isEditing || isDeleting}
          onClick={(event) => {
            if (isEditing) {
              event.preventDefault()
              return
            }
            onSelect(server.id)
          }}
          draggable={false}
        >
          <span
            className='flex h-5 w-5 items-center justify-center rounded-xs p-0.5'
            style={{
              backgroundColor: `${iconColor}20`,
            }}
            aria-hidden='true'
          >
            <Server className='h-full' aria-hidden='true' style={{ color: iconColor }} />
          </span>
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              className={cn(
                'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium font-sans text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
              )}
              maxLength={100}
              disabled={isRenaming}
              onClick={(event) => event.preventDefault()}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
            />
          ) : (
            <Tooltip delayDuration={1000}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'min-w-0 flex-1 select-none truncate pr-1 font-medium font-sans text-sm',
                    isSelected
                      ? 'text-foreground'
                      : 'text-muted-foreground group-hover:text-foreground'
                  )}
                >
                  {displayName}
                </span>
              </TooltipTrigger>
              <TooltipContent side='top' align='start' sideOffset={10}>
                <p>{displayName}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </button>

        {canEdit && isHovered && !isEditing && (
          <div
            className='flex items-center justify-center gap-1'
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant='ghost'
              size='icon'
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
              onClick={(event) => {
                event.stopPropagation()
                handleStartEdit()
              }}
            >
              <Pencil className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Rename MCP server</span>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setShowDeleteDialog(true)}
              disabled={isDeleting}
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-50'
            >
              <Trash2 className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Delete MCP server</span>
            </Button>
          </div>
        )}
      </div>

      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!isDeleting) {
            setShowDeleteDialog((prev) => (prev === open ? prev : open))
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MCP server?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this MCP server will permanently remove its configuration.{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmDelete()
              }}
              disabled={isDeleting}
              variant='destructive'
              className='h-9 w-full rounded-sm'
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const listMcpWidget: DashboardWidgetDefinition = {
  key: 'list_mcp',
  title: 'MCP List',
  icon: Server,
  category: 'list',
  description: 'Browse and manage MCP servers for the workspace.',
  component: (props: WidgetComponentProps) => {
    const workspaceId = props.context?.workspaceId ?? null

    if (!workspaceId) {
      return <WidgetMessage message='Select a workspace to browse MCP servers.' />
    }

    return (
      <WorkspacePermissionsProvider workspaceId={workspaceId}>
        <ListMcpWidgetContent {...props} />
      </WorkspacePermissionsProvider>
    )
  },
  renderHeader: ({ widget, context, panelId }) => ({
    right: (
      <ListMcpHeaderRight
        workspaceId={context?.workspaceId}
        panelId={panelId}
        pairColor={widget?.pairColor}
      />
    ),
  }),
}
