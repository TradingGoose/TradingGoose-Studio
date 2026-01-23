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
import { cn } from '@/lib/utils'
import { shallow } from 'zustand/shallow'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import type { PairColor } from '@/widgets/pair-colors'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

const DEFAULT_PLACEHOLDER = 'Select workflow'
const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'

interface WorkflowDropdownProps {
  workspaceId?: string | null
  value?: string | null
  onChange?: (workflowId: string, workflow?: WorkflowMetadata) => void
  disabled?: boolean
  placeholder?: string
  pairColor?: PairColor
  align?: 'start' | 'end'
  triggerClassName?: string
  menuClassName?: string
  includeMarketplace?: boolean
}

export function WorkflowDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  pairColor,
  align = 'start',
  triggerClassName,
  menuClassName,
  includeMarketplace = true,
}: WorkflowDropdownProps) {
  const [open, setOpen] = useState(false)
  const [internalValue, setInternalValue] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasRequestedLoad, setHasRequestedLoad] = useState(false)
  const [isLocallyLoading, setIsLocallyLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const {
    workflows: registryWorkflows,
    isLoading: registryLoading,
    loadWorkflows,
  } = useWorkflowRegistry(
    (state) => ({
      workflows: state.workflows,
      isLoading: state.isLoading,
      loadWorkflows: state.loadWorkflows,
    }),
    shallow
  )

  const resolvedPairColor = pairColor && pairColor !== 'gray' ? pairColor : 'gray'
  const isPairContextActive = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const workspaceWorkflows = useMemo(() => {
    if (!workspaceId) return []

    const scoped = Object.values(registryWorkflows ?? {}).filter((workflow) => {
      if (!workflow || workflow.workspaceId !== workspaceId) {
        return false
      }

      if (includeMarketplace) {
        return true
      }

      return !workflow.marketplaceData
    })

    return scoped.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }, [registryWorkflows, workspaceId, includeMarketplace])

  const isControlled = typeof value !== 'undefined'
  const selectedWorkflowId = isControlled ? value ?? null : internalValue
  const selectedWorkflow = workspaceWorkflows.find((workflow) => workflow.id === selectedWorkflowId)
  const isLoading = registryLoading || isLocallyLoading
  const isDropdownDisabled = disabled || !workspaceId
  const tooltipText = !workspaceId
    ? 'Select a workspace to choose workflows'
    : loadError
      ? 'Unable to load workflows'
      : disabled
        ? 'Workflow selection unavailable'
        : 'Select workflow'

  // Reset internal state when workspace changes
  useEffect(() => {
    setLoadError(null)
    setHasRequestedLoad(false)
    setSearchQuery('')
    if (!isControlled) {
      setInternalValue(null)
    }
  }, [workspaceId, isControlled])

  // Request workflows for workspace when needed
  useEffect(() => {
    if (!workspaceId || workspaceWorkflows.length > 0 || hasRequestedLoad) {
      return
    }

    let cancelled = false
    setHasRequestedLoad(true)
    setIsLocallyLoading(true)
    setLoadError(null)

    loadWorkflows(workspaceId)
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load workflows for workflow dropdown', error)
          setLoadError('Failed to load workflows')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLocallyLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, workspaceWorkflows.length, hasRequestedLoad, loadWorkflows])

  // Keep internal selection in sync with pair context when uncontrolled
  useEffect(() => {
    if (isControlled || !isPairContextActive) {
      return
    }

    const nextId = pairContext?.workflowId ?? null
    if (!nextId) {
      return
    }

    if (!workspaceWorkflows.some((workflow) => workflow.id === nextId)) {
      return
    }

    setInternalValue(nextId)
  }, [isControlled, resolvedPairColor, pairContext?.workflowId, workspaceWorkflows])

  // Fallback to first available workflow when uncontrolled
  useEffect(() => {
    if (isControlled || internalValue || workspaceWorkflows.length === 0) {
      return
    }

    setInternalValue(workspaceWorkflows[0].id)
  }, [isControlled, internalValue, workspaceWorkflows])

  const handleSelect = (workflow: WorkflowMetadata) => {
    if (!workflow) {
      return
    }

    if (!isControlled) {
      setInternalValue(workflow.id)
    }

    if (isPairContextActive) {
      setPairContext(resolvedPairColor, {
        ...(pairContext ?? {}),
        workflowId: workflow.id,
      })
    }

    onChange?.(workflow.id, workflow)
    setOpen(false)
  }

  const handleRetry = () => {
    if (!workspaceId) return
    setLoadError(null)
    setHasRequestedLoad(false)
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
      const name = workflow.name || 'Untitled workflow'
      return (
        name.toLowerCase().includes(normalizedQuery) ||
        workflow.id.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [workspaceWorkflows, searchQuery])

  const renderMenuBody = () => {
    if (!workspaceId) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          Select a workspace first.
        </p>
      )
    }

    if (loadError) {
      return (
        <div className='space-y-2 px-3 py-2 text-xs'>
          <p className='text-destructive'>{loadError}. Try reloading the widget.</p>
          <button
            type='button'
            className='text-primary text-xs font-semibold hover:underline'
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      )
    }

    const shouldShowLoadingState = isLoading && workspaceWorkflows.length === 0

    if (shouldShowLoadingState) {
      return (
        <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          Loading workflows…
        </div>
      )
    }

    if (filteredWorkflows.length === 0) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          {searchQuery.trim() ? 'No workflows found.' : 'No workflows available yet.'}
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
              onSelect={(event) => {
                event.preventDefault()
                if (isSelected) return
                handleSelect(workflow)
              }}
            >
              <div className='flex min-w-0 items-center gap-2'>
                <span
                  className='h-5 w-5 p-0.5 rounded-xs'
                  style={{
                    backgroundColor: workflow.color + '50',
                  }}
                  aria-hidden='true'
                >
                  <Workflow className='h-full' aria-hidden='true' style={{ color: workflow.color }} />
                </span>
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                  {workflow.name || 'Untitled workflow'}
                </span>
              </div>
              {isSelected ? <Check className='h-3.5 w-3.5 text-primary' /> : null}
            </DropdownMenuItem>
          )
        })}
      </div>
    )
  }

  const chevronClassName = cn(
    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
    open && 'rotate-180'
  )

  const colorBadge = (
    <div
      className='h-5 w-5 p-0.5 rounded-xs'
      style={{
        backgroundColor: selectedWorkflow?.color + '50',
      }}
      aria-hidden='true'
    >
      <Workflow className='h-4 w-4' aria-hidden='true' style={{ color: selectedWorkflow?.color }} />
    </div>
  )

  const labelContent = selectedWorkflow ? (
    <span className='min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground'>
      {selectedWorkflow.name || 'Untitled workflow'}
    </span>
  ) : (
    <span className='min-w-0 flex-1 truncate text-left text-sm font-medium text-muted-foreground'>
      {placeholder}
    </span>
  )

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (isDropdownDisabled) return
        setOpen(nextOpen)
      }}
      modal={false}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              disabled={isDropdownDisabled}
              className={widgetHeaderControlClassName(
                cn('flex items-center gap-2 min-w-[240px] justify-between', triggerClassName)
              )}
              aria-haspopup='listbox'
            >
              {colorBadge}
              {labelContent}
              <ChevronDown className={chevronClassName} aria-hidden='true' />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className={cn(
          widgetHeaderMenuContentClassName,
          'w-[240px] max-h-[20rem] overflow-hidden p-0 shadow-lg',
          menuClassName
        )}
        style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className='flex h-full max-h-[inherit] flex-col'>
          <div className='border-border/70 border-b p-2'>
            <div className='flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-muted-foreground text-sm'>
              <Search className='h-3.5 w-3.5 shrink-0' />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder='Search workflows...'
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
