'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, Wrench } from 'lucide-react'
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
import { useCustomTools } from '@/hooks/queries/custom-tools'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

const DEFAULT_PLACEHOLDER = 'Select custom tool'
const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'
const CUSTOM_TOOL_ICON_COLOR = '#d97706'

interface CustomToolDropdownProps {
  workspaceId?: string | null
  value?: string | null
  onChange?: (customToolId: string | null, tool?: CustomToolDefinition) => void
  disabled?: boolean
  placeholder?: string
  align?: 'start' | 'end'
  triggerClassName?: string
  menuClassName?: string
}

const getToolTitle = (tool?: CustomToolDefinition | null) =>
  tool?.title || tool?.schema?.function?.name || 'Custom Tool'

export function CustomToolDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  align = 'start',
  triggerClassName,
  menuClassName,
}: CustomToolDropdownProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const {
    data: queryTools = [],
    error: toolsError,
    isLoading: toolsLoading,
    isFetching,
    refetch,
  } = useCustomTools(workspaceId ?? '')
  const storedTools = useCustomToolsStore((state) =>
    workspaceId ? state.getAllTools(workspaceId) : []
  )

  const workspaceTools = useMemo(() => {
    const tools = queryTools.length > 0 ? queryTools : storedTools
    return [...tools].sort((a, b) => {
      const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '')
      const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '')
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
    })
  }, [queryTools, storedTools])

  const selectedToolId = value ?? null
  const selectedTool = workspaceTools.find((tool) => tool.id === selectedToolId) ?? null
  const hasTools = workspaceTools.length > 0
  const isLoading = (toolsLoading || isFetching) && !hasTools
  const isDropdownDisabled = disabled || !workspaceId
  const errorMessage =
    toolsError instanceof Error
      ? toolsError.message
      : toolsError
        ? 'Unable to load custom tools'
        : null
  const tooltipText = !workspaceId
    ? 'Select a workspace to choose custom tools'
    : errorMessage
      ? 'Unable to load custom tools'
      : disabled
        ? 'Custom tool selection unavailable'
        : 'Select custom tool'

  useEffect(() => {
    setSearchQuery('')
  }, [workspaceId])

  const handleSearchInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return

    if (event.nativeEvent.isComposing || event.key.length === 1) {
      event.stopPropagation()
    }
  }, [])

  const filteredTools = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return workspaceTools

    return workspaceTools.filter((tool) => {
      const title = getToolTitle(tool).toLowerCase()
      const description = tool.schema?.function?.description?.toLowerCase() ?? ''
      return title.includes(normalizedQuery) || description.includes(normalizedQuery)
    })
  }, [searchQuery, workspaceTools])

  const handleRetry = () => {
    if (!workspaceId) return
    refetch().catch((error) => {
      console.error('Failed to reload custom tools for custom tool dropdown', error)
    })
  }

  const handleSelect = (tool: CustomToolDefinition) => {
    onChange?.(tool.id, tool)
  }

  const renderMenuBody = () => {
    if (!workspaceId) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          Select a workspace first.
        </p>
      )
    }

    if (errorMessage && !hasTools) {
      return (
        <div className='space-y-2 px-3 py-2 text-xs'>
          <p className='text-destructive'>{errorMessage}. Try reloading the widget.</p>
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

    if (isLoading) {
      return (
        <div className='flex items-center gap-1 px-3 py-2 text-muted-foreground text-xs'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          Loading custom tools...
        </div>
      )
    }

    if (!hasTools) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          No custom tools available yet.
        </p>
      )
    }

    if (filteredTools.length === 0) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {searchQuery.trim() ? 'No custom tools found.' : 'No custom tools available yet.'}
        </p>
      )
    }

    return (
      <div className='flex flex-col gap-1'>
        {filteredTools.map((tool) => {
          const isSelected = tool.id === selectedToolId
          return (
            <DropdownMenuItem
              key={tool.id}
              className={cn(widgetHeaderMenuItemClassName, 'justify-between')}
              data-active={isSelected ? '' : undefined}
              onSelect={() => {
                if (isSelected) return
                handleSelect(tool)
              }}
            >
              <div className='flex min-w-0 items-center gap-2'>
                <span
                  className='h-5 w-5 rounded-xs p-0.5'
                  style={{ backgroundColor: `${CUSTOM_TOOL_ICON_COLOR}20` }}
                  aria-hidden='true'
                >
                  <Wrench
                    className='h-4 w-4'
                    aria-hidden='true'
                    style={{ color: CUSTOM_TOOL_ICON_COLOR }}
                  />
                </span>
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                  {getToolTitle(tool)}
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
      style={{ backgroundColor: `${CUSTOM_TOOL_ICON_COLOR}20` }}
      aria-hidden='true'
    >
      <Wrench className='h-4 w-4' aria-hidden='true' style={{ color: CUSTOM_TOOL_ICON_COLOR }} />
    </span>
  )

  const labelContent = selectedTool ? (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
      {getToolTitle(selectedTool)}
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
                {isLoading ? (
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
          'max-h-[20rem] w-[240px] overflow-hidden p-0 shadow-lg',
          menuClassName
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
                placeholder='Search tools...'
                className='h-6 border-0 bg-transparent px-0 text-foreground text-xs placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                onKeyDown={handleSearchInputKeyDown}
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
