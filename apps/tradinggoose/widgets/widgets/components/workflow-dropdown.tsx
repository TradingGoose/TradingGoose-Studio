'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, Workflow } from 'lucide-react'
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
import { useWorkflowDropdownMessages } from '@/i18n/workspace-widget-hooks'

const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'

interface WorkflowDropdownProps {
  workspaceId?: string | null
  value?: string | null
  onChange?: (workflowId: string, workflow?: WorkflowDropdownOption) => void
  disabled?: boolean
  placeholder?: string
  align?: 'start' | 'end'
  triggerClassName?: string
  menuClassName?: string
}

type WorkflowDropdownOption = {
  id: string
  name: string
  description: string
  color: string
  workspaceId: string
  folderId?: string | null
}

export function WorkflowDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder,
  align = 'start',
  triggerClassName,
  menuClassName,
}: WorkflowDropdownProps) {
  const copy = useWorkflowDropdownMessages()
  const [searchQuery, setSearchQuery] = useState('')
  const { members, error, isLoading } = useEntityList('workflow', workspaceId)

  const workspaceWorkflows = useMemo<WorkflowDropdownOption[]>(() => {
    if (!workspaceId) return []

    return [...members]
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .map((member) => ({
        id: member.entityId,
        name: member.entityName,
        description: member.entityDescription ?? '',
        color: getEntityIconColor(member.entityId, member.color),
        workspaceId,
        folderId: member.folderId ?? null,
      }))
  }, [members, workspaceId])

  const selectedWorkflowId = value ?? null
  const selectedWorkflow = workspaceWorkflows.find((workflow) => workflow.id === selectedWorkflowId)
  const hasWorkflows = workspaceWorkflows.length > 0
  const isDropdownDisabled = disabled || !workspaceId
  const tooltipText = !workspaceId
    ? copy.selectWorkspaceFirst
    : error && !hasWorkflows
      ? copy.unableToLoad
      : disabled
        ? copy.workflowSelectionUnavailable
        : copy.selectWorkflow
  const resolvedPlaceholder = placeholder ?? copy.selectWorkflow

  useEffect(() => {
    setSearchQuery('')
  }, [workspaceId])

  const handleSelect = (workflow: WorkflowDropdownOption) => {
    if (!workflow) {
      return
    }

    onChange?.(workflow.id, workflow)
  }

  const handleSearchInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return

    if (event.nativeEvent.isComposing || event.key.length === 1) {
      event.stopPropagation()
    }
  }, [])

  const filteredWorkflows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return workspaceWorkflows

    return workspaceWorkflows.filter((workflow) => {
      const name = workflow.name || copy.untitledWorkflow
      return (
        name.toLowerCase().includes(normalizedQuery) ||
        workflow.description.toLowerCase().includes(normalizedQuery) ||
        workflow.id.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [workspaceWorkflows, searchQuery, copy.untitledWorkflow])

  const renderMenuBody = () => {
    if (!workspaceId) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {copy.selectWorkspaceFirst}
        </p>
      )
    }

    if (error && !hasWorkflows) {
      return (
        <div className='space-y-2 px-3 py-2 text-xs'>
          <p className='text-destructive'>{error}</p>
        </div>
      )
    }

    const shouldShowLoadingState = isLoading && workspaceWorkflows.length === 0

    if (shouldShowLoadingState) {
      return (
        <div className='flex items-center gap-1 px-3 py-2 text-muted-foreground text-xs'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          {copy.loading}
        </div>
      )
    }

    if (filteredWorkflows.length === 0) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {searchQuery.trim() ? copy.noWorkflowsFound : copy.noWorkflowsAvailable}
        </p>
      )
    }

    return (
      <div className='flex flex-col gap-1'>
        {filteredWorkflows.map((workflow) => {
          const isSelected = workflow.id === selectedWorkflowId
          return (
            <DropdownMenuItem
              key={workflow.id}
              className={cn(widgetHeaderMenuItemClassName, 'justify-between')}
              data-active={isSelected ? '' : undefined}
              onSelect={() => {
                if (isSelected) return
                handleSelect(workflow)
              }}
            >
              <div className='flex min-w-0 items-center gap-2'>
                <span
                  className='h-5 w-5 rounded-xs p-0.5'
                  style={{
                    backgroundColor: `${workflow.color}20`,
                  }}
                  aria-hidden='true'
                >
                  <Workflow
                    className='h-full'
                    aria-hidden='true'
                    style={{ color: workflow.color }}
                  />
                </span>
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                  {workflow.name || copy.untitledWorkflow}
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
  const selectedWorkflowColor = getEntityIconColor(selectedWorkflow?.id, selectedWorkflow?.color)
  const colorBadge = (
    <div
      className='h-5 w-5 rounded-xs p-0.5'
      style={{
        backgroundColor: `${selectedWorkflowColor}20`,
      }}
      aria-hidden='true'
    >
      <Workflow className='h-4 w-4' aria-hidden='true' style={{ color: selectedWorkflowColor }} />
    </div>
  )
  const labelContent = selectedWorkflow ? (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
      {selectedWorkflow.name || copy.untitledWorkflow}
    </span>
  ) : (
    <span className='min-w-0 flex-1 truncate text-left font-medium text-muted-foreground text-sm'>
      {resolvedPlaceholder}
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
                {colorBadge}
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
