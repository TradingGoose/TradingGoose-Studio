'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Server, Trash2 } from 'lucide-react'
import { useMessages } from 'next-intl'
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
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { cn } from '@/lib/utils'
import { saveSavedEntityField, useEntityList } from '@/lib/yjs/use-entity-fields'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { resolveEntityIdFromList } from '@/widgets/utils/entity-selection'
import { MCP_SERVER_DEFAULTS } from '@/widgets/utils/mcp-defaults'
import { emitMcpSelectionChange, useMcpSelectionPersistence } from '@/widgets/utils/mcp-selection'
import { resolveMcpServerId } from '@/widgets/widgets/_shared/mcp/utils'

const buildDefaultMcpServer = (name: string) => ({
  ...MCP_SERVER_DEFAULTS,
  enabled: false,
  name,
  transport: 'streamable-http' as const,
})

async function createMcpServer(
  workspaceId: string,
  config: ReturnType<typeof buildDefaultMcpServer>
) {
  const response = await fetch('/api/mcp/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...config, workspaceId }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to create MCP server')
  const serverId = typeof data?.data?.serverId === 'string' ? data.data.serverId : null
  if (!serverId) throw new Error('Created MCP server is missing an id')
  return serverId
}

async function deleteMcpServer(workspaceId: string, serverId: string) {
  const response = await fetch(
    `/api/mcp/servers?serverId=${encodeURIComponent(serverId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'DELETE' }
  )
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to delete MCP server')
}

const WidgetMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

type McpServerListEntry = {
  id: string
  workspaceId: string
  name: string
  enabled: boolean
}

const getServerName = (server: McpServerListEntry, fallback: string) => server.name || fallback

const McpCreateMenu = ({
  disabled = false,
  copy,
  onCreateServer,
}: {
  disabled?: boolean
  copy: {
    createMcpServer: string
    create: string
    newMcpServer: string
  }
  onCreateServer?: () => void
}) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <DropdownMenuTrigger asChild>
            <button type='button' disabled={disabled} className={widgetHeaderIconButtonClassName()}>
              <Plus className='h-4 w-4' />
              <span className='sr-only'>{copy.createMcpServer}</span>
            </button>
          </DropdownMenuTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>{copy.create}</TooltipContent>
    </Tooltip>
    <DropdownMenuContent sideOffset={6} className={cn(widgetHeaderMenuContentClassName, 'w-44')}>
      <DropdownMenuItem className={widgetHeaderMenuItemClassName} onSelect={onCreateServer}>
        <Plus className={widgetHeaderMenuIconClassName} />
        <span className={widgetHeaderMenuTextClassName}>{copy.newMcpServer}</span>
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
  const copy = useMessages().workspace.widgets.mcpList
  const permissions = useUserPermissionsContext()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const { members } = useEntityList('mcp_server', workspaceId)
  const [pendingCreatedServerId, setPendingCreatedServerId] = useState<string | null>(null)

  const selectServer = useCallback(
    (serverId: string) => {
      if (isLinkedToColorPair) {
        setPairContext(resolvedPairColor, { mcpServerId: serverId })
        return
      }

      emitMcpSelectionChange({
        serverId,
        panelId,
        widgetKey: 'list_mcp',
      })
      emitMcpSelectionChange({
        serverId,
        panelId,
        widgetKey: 'editor_mcp',
      })
    },
    [isLinkedToColorPair, panelId, resolvedPairColor, setPairContext]
  )

  useEffect(() => {
    if (!pendingCreatedServerId) return
    if (!members.some((member) => member.entityId === pendingCreatedServerId)) return
    selectServer(pendingCreatedServerId)
    setPendingCreatedServerId(null)
  }, [members, pendingCreatedServerId, selectServer])

  const handleCreateServer = useCallback(() => {
    if (!workspaceId || !permissions.canEdit) return

    void createMcpServer(workspaceId, buildDefaultMcpServer(copy.defaults.newMcpServerName))
      .then((createdServerId) => {
        if (members.some((member) => member.entityId === createdServerId)) {
          selectServer(createdServerId)
        } else {
          setPendingCreatedServerId(createdServerId)
        }
      })
      .catch((error) => {
        console.error('Failed to create MCP server from list widget', error)
      })
  }, [copy.defaults.newMcpServerName, members, permissions.canEdit, selectServer, workspaceId])

  return (
    <McpCreateMenu
      disabled={!workspaceId || !permissions.canEdit}
      copy={copy.createMenu}
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
  const copy = useMessages().workspace.widgets.mcpList
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
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
  const copy = useMessages().workspace.widgets.mcpList
  const permissions = useUserPermissionsContext()
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { members, isLoading, error } = useEntityList('mcp_server', workspaceId)
  const { refreshTools } = useMcpTools(workspaceId ?? '')
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const workspaceServers = useMemo<McpServerListEntry[]>(
    () =>
      workspaceId
        ? members
            .map((member) => ({
              id: member.entityId,
              workspaceId,
              name: member.entityName,
              enabled: member.enabled !== false,
            }))
            .sort((a, b) => getServerName(a, '').localeCompare(getServerName(b, '')))
        : [],
    [members, workspaceId]
  )

  const requestedServerId = resolveMcpServerId({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
  })
  const selectedServerId = resolveEntityIdFromList({
    requestedEntityId: requestedServerId,
    entityIds: workspaceServers.map((server) => server.id),
    useDefaultEntity: false,
  })

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
      pairContext,
      params,
      resolvedPairColor,
      setPairContext,
    ]
  )

  const handleRenameServer = useCallback(
    async (serverId: string, name: string) => {
      if (!workspaceId || !permissions.canEdit) return

      await saveSavedEntityField('mcp_server', serverId, workspaceId, 'name', name)
      await refreshTools()
    },
    [permissions.canEdit, refreshTools, workspaceId]
  )

  const handleDeleteServer = useCallback(
    async (serverId: string) => {
      if (!workspaceId || !permissions.canEdit) return
      if (deletingIds.has(serverId)) return

      setDeletingIds((prev) => new Set(prev).add(serverId))
      try {
        await deleteMcpServer(workspaceId, serverId)
        await refreshTools()
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
      deletingIds,
      handleSelectServer,
      permissions.canEdit,
      refreshTools,
      selectedServerId,
      workspaceId,
    ]
  )

  if (!workspaceId) {
    return <WidgetMessage message={copy.body.selectWorkspace} />
  }

  if (error && workspaceServers.length === 0) {
    return <WidgetMessage message={error} />
  }

  if (isLoading && workspaceServers.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {workspaceServers.length === 0 ? (
        <WidgetMessage message={copy.body.noMcpServersYet} />
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
  server: McpServerListEntry
  isSelected: boolean
  onSelect: (serverId: string | null) => void
  onRename: (serverId: string, name: string) => Promise<void>
  onDelete: (serverId: string) => void | Promise<void>
  canEdit: boolean
  isDeleting: boolean
}) => {
  const copy = useMessages().workspace.widgets.mcpList.listItem
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(server.name ?? '')
  const [isRenaming, setIsRenaming] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayName = getServerName(server, copy.unnamedMcpServer)
  const iconColor = '#64748b'

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
              <span className='sr-only'>{copy.renameMcpServer}</span>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setShowDeleteDialog(true)}
              disabled={isDeleting}
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-50'
            >
              <Trash2 className='!h-3.5 !w-3.5' />
              <span className='sr-only'>{copy.deleteMcpServer}</span>
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
            <AlertDialogTitle>{copy.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.deleteDialogDescription}{' '}
              <span className='text-red-500 dark:text-red-500'>
                {copy.deleteDialogDescriptionHighlight}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
              {copy.cancel}
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
              {copy.delete}
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
    const copy = useMessages().workspace.widgets.mcpList
    const workspaceId = props.context?.workspaceId ?? null

    if (!workspaceId) {
      return <WidgetMessage message={copy.body.selectWorkspace} />
    }

    return (
      <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
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
