'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, Server } from 'lucide-react'
import { useMessages } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { cn } from '@/lib/utils'
import { useEntityList } from '@/lib/yjs/use-entity-fields'

const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'
const MCP_ICON_COLOR = '#64748b'

interface McpDropdownProps {
  workspaceId?: string | null
  value?: string | null
  onChange?: (serverId: string | null) => void
  disabled?: boolean
  placeholder?: string
  align?: 'start' | 'end'
  triggerClassName?: string
}

type McpDropdownOption = {
  id: string
  name: string
  workspaceId: string
  enabled?: boolean
}

const getServerLabel = (server?: McpDropdownOption | null, fallbackLabel?: string) =>
  server?.name || server?.id || fallbackLabel || ''

export function McpDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder,
  align = 'start',
  triggerClassName,
}: McpDropdownProps) {
  const copy = useMessages().workspace.widgets.mcpDropdown
  const [searchQuery, setSearchQuery] = useState('')
  const { members, isLoading, error, retry } = useEntityList('mcp_server', workspaceId)

  const workspaceServers = useMemo(() => {
    if (!workspaceId) return []

    return members
      .filter((member) => member.enabled !== false)
      .map((member) => ({
        id: member.entityId,
        name: member.entityName,
        workspaceId,
        enabled: member.enabled,
      }))
      .sort((a, b) => getServerLabel(a).localeCompare(getServerLabel(b)))
  }, [members, workspaceId])

  const selectedServerId = value ?? null
  const selectedServer = workspaceServers.find((server) => server.id === selectedServerId) ?? null
  const hasServers = workspaceServers.length > 0
  const isDropdownDisabled = disabled || !workspaceId
  const tooltipText = !workspaceId
    ? copy.selectWorkspaceFirst
    : error
      ? copy.unableToLoad
      : disabled
        ? copy.mcpSelectionUnavailable
        : copy.selectMcpServer
  const resolvedPlaceholder = placeholder ?? copy.selectMcpServer

  useEffect(() => {
    setSearchQuery('')
  }, [workspaceId])

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
      return name.includes(normalizedQuery) || id.includes(normalizedQuery)
    })
  }, [searchQuery, workspaceServers])

  const handleSelect = (server: McpDropdownOption) => {
    onChange?.(server.id)
  }

  const renderMenuBody = () => {
    if (!workspaceId) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {copy.selectWorkspaceFirst}
        </p>
      )
    }

    if (error && !hasServers) {
      return (
        <div className='space-y-2 px-3 py-2 text-xs'>
          <p className='text-destructive'>{error}</p>
        </div>
      )
    }

    if (isLoading && !hasServers) {
      return (
        <div className='flex items-center gap-1 px-3 py-2 text-muted-foreground text-xs'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          {copy.loading}
        </div>
      )
    }

    if (!hasServers) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {copy.noServersAvailable}
        </p>
      )
    }

    if (filteredServers.length === 0) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {searchQuery.trim() ? copy.noServersFound : copy.noServersAvailable}
        </p>
      )
    }

    return (
      <div className='flex flex-col gap-1'>
        {filteredServers.map((server) => {
          const isSelected = server.id === selectedServerId

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
                  style={{ backgroundColor: `${MCP_ICON_COLOR}20` }}
                  aria-hidden='true'
                >
                  <Server
                    className='h-full w-full'
                    aria-hidden='true'
                    style={{ color: MCP_ICON_COLOR }}
                  />
                </span>
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                  {getServerLabel(server, copy.unnamedServer)}
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
  const iconBadge = (
    <span
      className='h-5 w-5 rounded-xs p-0.5'
      style={{ backgroundColor: `${MCP_ICON_COLOR}20` }}
      aria-hidden='true'
    >
      <Server className='h-full w-full' aria-hidden='true' style={{ color: MCP_ICON_COLOR }} />
    </span>
  )
  const labelContent = selectedServer ? (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
      {getServerLabel(selectedServer, copy.unnamedServer)}
    </span>
  ) : (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-muted-foreground text-sm'>
      {resolvedPlaceholder}
    </span>
  )

  return (
    <DropdownMenu modal={false} onOpenChange={(open) => open && error && retry?.()}>
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
                placeholder={copy.searchPlaceholder}
                className='h-6 border-0 bg-transparent px-0 text-foreground text-xs placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                onKeyDown={handleSearchInputKeyDown}
                autoComplete='off'
                autoCorrect='off'
                spellCheck='false'
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
