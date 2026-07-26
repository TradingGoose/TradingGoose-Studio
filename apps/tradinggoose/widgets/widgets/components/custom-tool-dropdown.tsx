'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, Wrench } from 'lucide-react'
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
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { useEntityList } from '@/lib/yjs/use-entity-fields'

const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'

interface CustomToolDropdownProps {
  workspaceId?: string | null
  value?: string | null
  onChange?: (customToolId: string | null) => void
  disabled?: boolean
  placeholder?: string
  align?: 'start' | 'end'
  triggerClassName?: string
  menuClassName?: string
}

type CustomToolDropdownOption = {
  id: string
  title: string
  description: string
}

const getToolTitle = (tool?: CustomToolDropdownOption | null) => tool?.title.trim() ?? ''

export function CustomToolDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder,
  align = 'start',
  triggerClassName,
  menuClassName,
}: CustomToolDropdownProps) {
  const copy = useMessages().workspace.widgets.customToolDropdown
  const [searchQuery, setSearchQuery] = useState('')
  const { members, error, isLoading: listLoading } = useEntityList('custom_tool', workspaceId)

  const workspaceTools = useMemo(() => {
    if (!workspaceId) return []
    return members.map((member) => ({
      id: member.entityId,
      title: member.entityName,
      description: member.entityDescription ?? '',
    }))
  }, [members, workspaceId])

  const selectedToolId = value ?? null
  const selectedTool = workspaceTools.find((tool) => tool.id === selectedToolId) ?? null
  const hasTools = workspaceTools.length > 0
  const isLoading = listLoading && !hasTools
  const isDropdownDisabled = disabled || !workspaceId
  const errorMessage = error || null
  const tooltipText = !workspaceId
    ? copy.selectWorkspaceToChooseCustomTools
    : errorMessage
      ? copy.unableToLoadCustomTools
      : disabled
        ? copy.selectionUnavailable
        : copy.tooltip

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
      return (
        title.includes(normalizedQuery) || tool.description.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [searchQuery, workspaceTools])

  const handleSelect = (tool: CustomToolDropdownOption) => {
    onChange?.(tool.id)
  }

  const renderMenuBody = () => {
    if (!workspaceId) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {copy.selectWorkspaceFirst}
        </p>
      )
    }

    if (errorMessage && !hasTools) {
      return (
        <div className='space-y-2 px-3 py-2 text-xs'>
          <p className='text-destructive'>{errorMessage}</p>
        </div>
      )
    }

    if (isLoading) {
      return (
        <div className='flex items-center gap-1 px-3 py-2 text-muted-foreground text-xs'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          {copy.loadingCustomTools}
        </div>
      )
    }

    if (!hasTools) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {copy.noCustomToolsAvailableYet}
        </p>
      )
    }

    if (filteredTools.length === 0) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {searchQuery.trim() ? copy.noCustomToolsFound : copy.noCustomToolsAvailableYet}
        </p>
      )
    }

    return (
      <div className='flex flex-col gap-1'>
        {filteredTools.map((tool) => {
          const isSelected = tool.id === selectedToolId
          const iconColor = getEntityIconColor(tool.id)
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
                  style={{ backgroundColor: `${iconColor}20` }}
                  aria-hidden='true'
                >
                  <Wrench className='h-4 w-4' aria-hidden='true' style={{ color: iconColor }} />
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
  const selectedIconColor = getEntityIconColor(selectedToolId)

  const iconBadge = (
    <span
      className='h-5 w-5 rounded-xs p-0.5'
      style={{ backgroundColor: `${selectedIconColor}20` }}
      aria-hidden='true'
    >
      <Wrench className='h-4 w-4' aria-hidden='true' style={{ color: selectedIconColor }} />
    </span>
  )

  const labelContent = selectedTool ? (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
      {getToolTitle(selectedTool)}
    </span>
  ) : (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-muted-foreground text-sm'>
      {placeholder ?? copy.placeholder}
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
                placeholder={copy.searchPlaceholder}
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
