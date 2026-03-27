'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, Server } from 'lucide-react'
import { shallow } from 'zustand/shallow'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

const DEFAULT_PLACEHOLDER = 'Select MCP server'
const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'

interface McpDropdownProps {
  workspaceId?: string | null
  value?: string | null
  onChange?: (serverId: string | null) => void
  disabled?: boolean
  placeholder?: string
  align?: 'start' | 'end'
  triggerClassName?: string
}

const getServerIconColor = (status?: McpServerWithStatus['connectionStatus']) => {
  if (status === 'connected') {
    return '#10b981'
  }

  if (status === 'error') {
    return '#ef4444'
  }

  return '#64748b'
}

const getServerLabel = (server?: McpServerWithStatus | null) =>
  server?.name || server?.id || 'Unnamed server'

export function McpDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  align = 'start',
  triggerClassName,
}: McpDropdownProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const { servers, isLoading, error, fetchServers } = useMcpServersStore(
    (state) => ({
      servers: state.servers,
      isLoading: state.isLoading,
      error: state.error,
      fetchServers: state.fetchServers,
    }),
    shallow
  )

  const workspaceServers = useMemo(() => {
    if (!workspaceId) return []

    return servers
      .filter((server) => server.workspaceId === workspaceId && !server.deletedAt)
      .sort((a, b) => {
        const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '')
        const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '')
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
      })
  }, [servers, workspaceId])

  const selectedServerId = value ?? null
  const selectedServer = workspaceServers.find((server) => server.id === selectedServerId) ?? null
  const hasServers = workspaceServers.length > 0
  const isDropdownDisabled = disabled || !workspaceId
  const tooltipText = !workspaceId
    ? 'Select a workspace to choose MCP servers'
    : error
      ? 'Unable to load MCP servers'
      : disabled
        ? 'MCP selection unavailable'
        : 'Select MCP server'

  useEffect(() => {
    setSearchQuery('')
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || hasServers) {
      return
    }

    fetchServers(workspaceId).catch((fetchError) => {
      console.error('Failed to load MCP servers for dropdown', fetchError)
    })
  }, [fetchServers, hasServers, workspaceId])

  const handleSearchInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return

    if (event.nativeEvent.isComposing || event.key.length === 1) {
      event.stopPropagation()
    }
  }, [])

  const filteredServers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return workspaceServers
    }

    return workspaceServers.filter((server) => {
      const name = server.name?.toLowerCase() ?? ''
      const id = server.id.toLowerCase()
      const url = server.url?.toLowerCase() ?? ''
      return (
        name.includes(normalizedQuery) ||
        id.includes(normalizedQuery) ||
        url.includes(normalizedQuery)
      )
    })
  }, [searchQuery, workspaceServers])

  const handleRetry = () => {
    if (!workspaceId) return
    fetchServers(workspaceId).catch((fetchError) => {
      console.error('Failed to reload MCP servers for dropdown', fetchError)
    })
  }

  const handleSelect = (server: McpServerWithStatus) => {
    onChange?.(server.id)
  }

  const renderMenuBody = () => {
    if (!workspaceId) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          Select a workspace first.
        </p>
      )
    }

    if (error && !hasServers) {
      return (
        <div className='space-y-2 px-3 py-2 text-xs'>
          <p className='text-destructive'>Unable to load MCP servers.</p>
          <button
            type='button'
            className='font-semibold text-primary text-xs hover:underline'
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      )
    }

    if (isLoading && !hasServers) {
      return (
        <div className='flex items-center gap-1 px-3 py-2 text-muted-foreground text-xs'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          Loading MCP servers...
        </div>
      )
    }

    if (!hasServers) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          No MCP servers available yet.
        </p>
      )
    }

    if (filteredServers.length === 0) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {searchQuery.trim() ? 'No servers found.' : 'No MCP servers available yet.'}
        </p>
      )
    }

    return (
      <div className='flex flex-col gap-1'>
        {filteredServers.map((server) => {
          const isSelected = server.id === selectedServerId
          const iconColor = getServerIconColor(server.connectionStatus)

          return (
            <DropdownMenuItem
              key={server.id}
              className={cn(widgetHeaderMenuItemClassName, 'justify-between')}
              data-active={isSelected ? '' : undefined}
              onSelect={() => {
                if (isSelected) return
                handleSelect(server)
              }}
            >
              <div className='flex min-w-0 items-center gap-2'>
                <span
                  className='h-5 w-5 rounded-xs p-0.5'
                  style={{ backgroundColor: `${iconColor}20` }}
                  aria-hidden='true'
                >
                  <Server
                    className='h-full w-full'
                    aria-hidden='true'
                    style={{ color: iconColor }}
                  />
                </span>
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                  {getServerLabel(server)}
                </span>
              </div>
              {isSelected ? <Check className='h-3.5 w-3.5 text-primary' /> : null}
            </DropdownMenuItem>
          )
        })}
      </div>
    )
  }

  const chevronClassName =
    'h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
  const selectedIconColor = getServerIconColor(selectedServer?.connectionStatus)
  const iconBadge = (
    <span
      className='h-5 w-5 rounded-xs p-0.5'
      style={{ backgroundColor: `${selectedIconColor}20` }}
      aria-hidden='true'
    >
      <Server className='h-full w-full' aria-hidden='true' style={{ color: selectedIconColor }} />
    </span>
  )
  const labelContent = selectedServer ? (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
      {getServerLabel(selectedServer)}
    </span>
  ) : (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-muted-foreground text-sm'>
      {placeholder}
    </span>
  )

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                disabled={isDropdownDisabled}
                className={widgetHeaderControlClassName(
                  cn(
                    'group flex min-w-[240px] items-center justify-between gap-1',
                    triggerClassName
                  )
                )}
                aria-haspopup='listbox'
              >
                {isLoading && !hasServers ? (
                  <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
                ) : (
                  iconBadge
                )}
                {labelContent}
                <ChevronDown className={chevronClassName} aria-hidden='true' />
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className={cn(
          widgetHeaderMenuContentClassName,
          'max-h-[20rem] w-[240px] overflow-hidden p-0 shadow-lg'
        )}
        style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className='flex h-full max-h-[inherit] flex-col'>
          <div className='border-border/70 border-b p-2'>
            <div className='flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-muted-foreground text-sm'>
              <Search className='h-3.5 w-3.5 shrink-0' />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchInputKeyDown}
                placeholder='Search servers...'
                className='h-6 border-0 bg-transparent px-0 text-foreground text-xs placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                autoComplete='off'
                autoCorrect='off'
                spellCheck={false}
                disabled={isDropdownDisabled}
              />
            </div>
          </div>
          <div className='h-full min-h-0 flex-1 overflow-hidden'>
            <ScrollArea
              className='h-full w-full px-2 py-2'
              style={{
                height: DROPDOWN_VIEWPORT_HEIGHT,
                maxHeight: `calc(${DROPDOWN_MAX_HEIGHT} - 4rem)`,
              }}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {renderMenuBody()}
            </ScrollArea>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
