'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ChevronDown, Home, Loader2, User } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import {
  type SidebarDropdownGroup,
  type SidebarDropdownItem,
  SidebarDropdownMenuContent,
} from '@/components/ui/sidebar-dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { widgetHeaderControlClassName } from '@/components/widget-header-control'
import { DEFAULT_INDICATORS_META } from '@/lib/indicators/default'
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'

type IndicatorFilterId = 'default' | 'custom'

type IndicatorOption = {
  id: string
  name: string
  source: IndicatorFilterId
  color?: string
}

const resolveIndicatorColor = (indicator?: IndicatorOption | null): string => {
  return getEntityIconColor(indicator?.id, indicator?.color)
}

interface IndicatorDropdownProps {
  workspaceId?: string | null
  value?: string[]
  onChange?: (ids: string[]) => void
  disabled?: boolean
  placeholder?: string
  triggerClassName?: string
  menuClassName?: string
  selectionMode?: 'single' | 'multiple'
  includeDefaults?: boolean
}

export function IndicatorDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder,
  triggerClassName,
  menuClassName,
  selectionMode = 'multiple',
  includeDefaults = false,
}: IndicatorDropdownProps) {
  const widgetsCopy = useWorkspaceWidgetsMessages()
  const copy = widgetsCopy.indicatorDropdown
  const [internalValue, setInternalValue] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeFilterId, setActiveFilterId] = useState<IndicatorFilterId>(
    includeDefaults ? 'default' : 'custom'
  )
  const inputRef = useRef<HTMLInputElement>(null)

  const isMultiSelect = selectionMode === 'multiple'

  const {
    members,
    isLoading: listLoading,
    error: listError,
  } = useEntityList('indicator', workspaceId)

  const workspaceIndicators = useMemo(() => {
    if (!workspaceId) return []
    const scoped = members.map((member) => ({
      id: member.entityId,
      name: member.entityName,
      color: member.color,
    }))
    return scoped.sort((a, b) => a.name.localeCompare(b.name))
  }, [members, workspaceId])

  const defaultIndicatorOptions = useMemo<IndicatorOption[]>(
    () =>
      includeDefaults
        ? DEFAULT_INDICATORS_META.map((indicator) => ({
          id: indicator.id,
          name: indicator.name,
          source: 'default' as const,
          color: getEntityIconColor(indicator.id),
        }))
        : [],
    [includeDefaults]
  )

  const customIndicatorOptions = useMemo<IndicatorOption[]>(
    () =>
      workspaceIndicators.map((indicator) => ({
        id: indicator.id,
        name: indicator.name || indicator.id,
        source: 'custom' as const,
        color: indicator.color,
      })),
    [workspaceIndicators]
  )

  const indicatorOptions = useMemo<IndicatorOption[]>(
    () => [...defaultIndicatorOptions, ...customIndicatorOptions],
    [defaultIndicatorOptions, customIndicatorOptions]
  )

  const isControlled = typeof value !== 'undefined'
  const selectedIndicatorIds = isControlled ? (value ?? []) : internalValue
  const firstSelectedIndicatorId = selectedIndicatorIds[0] ?? null
  const selectedIndicatorSet = useMemo(() => new Set(selectedIndicatorIds), [selectedIndicatorIds])
  const selectedIndicatorId = !isMultiSelect ? (selectedIndicatorIds[0] ?? null) : null
  const selectedIndicator = !isMultiSelect
    ? indicatorOptions.find((indicator) => indicator.id === selectedIndicatorId)
    : null
  const selectedIndicatorColor = useMemo(() => {
    if (isMultiSelect) {
      const firstId = selectedIndicatorIds[0]
      if (!firstId) return null
      const indicator = indicatorOptions.find((item) => item.id === firstId)
      return resolveIndicatorColor(indicator ?? null)
    }
    if (!selectedIndicator) return null
    return resolveIndicatorColor(selectedIndicator)
  }, [isMultiSelect, selectedIndicatorIds, selectedIndicator, indicatorOptions])

  const hasIndicators = indicatorOptions.length > 0
  const isLoading = listLoading && !hasIndicators
  const isDropdownDisabled = disabled || !workspaceId
  const loadError = listError || null

  const tooltipText = !workspaceId
    ? copy.selectWorkspaceFirst
    : loadError
      ? copy.unableToLoadIndicators
      : disabled
        ? copy.selectionUnavailable
        : copy.tooltip

  useEffect(() => {
    setSearchQuery('')
    setDropdownOpen(false)
    setActiveFilterId(includeDefaults ? 'default' : 'custom')
    if (!isControlled) {
      setInternalValue([])
    }
  }, [workspaceId, isControlled, includeDefaults])

  const selectedFilterId = useMemo<IndicatorFilterId>(() => {
    if (!includeDefaults) return 'custom'
    if (!firstSelectedIndicatorId) return 'default'
    return defaultIndicatorOptions.some((option) => option.id === firstSelectedIndicatorId)
      ? 'default'
      : 'custom'
  }, [defaultIndicatorOptions, firstSelectedIndicatorId, includeDefaults])

  const handleSelectionChange = (nextIds: string[]) => {
    if (isControlled) {
      onChange?.(nextIds)
    } else {
      setInternalValue(nextIds)
      onChange?.(nextIds)
    }
  }

  const handleToggleIndicator = (id: string) => {
    if (isMultiSelect) {
      const next = selectedIndicatorSet.has(id)
        ? selectedIndicatorIds.filter((item) => item !== id)
        : [...selectedIndicatorIds, id]
      handleSelectionChange(next)
      return
    }
    handleSelectionChange([id])
  }

  const selectionLabel = useMemo(() => {
    const resolvedPlaceholder = placeholder ?? copy.placeholder
    if (selectedIndicatorIds.length === 0) return resolvedPlaceholder
    const first = indicatorOptions.find((option) => option.id === selectedIndicatorIds[0])
    if (!first) return resolvedPlaceholder
    if (selectedIndicatorIds.length === 1) return first.name
    return `${first.name} +${selectedIndicatorIds.length - 1}`
  }, [copy.placeholder, indicatorOptions, placeholder, selectedIndicatorIds])
  const hasSelection = selectedIndicatorIds.length > 0

  const colorBadge = (
    <div
      className='h-5 w-5 rounded-xs p-0.5'
      style={{
        backgroundColor: `${selectedIndicatorColor ?? getEntityIconColor(null)}20`,
      }}
      aria-hidden='true'
    >
      <Activity
        className='h-4 w-4'
        aria-hidden='true'
        style={{ color: selectedIndicatorColor ?? getEntityIconColor(null) }}
      />
    </div>
  )

  const indicatorGroups = useMemo<SidebarDropdownGroup[]>(() => {
    const groups: SidebarDropdownGroup[] = []
    if (includeDefaults) {
      groups.push({
        id: 'default',
        label: copy.defaultIndicators,
        icon: Home,
      })
    }
    groups.push({
      id: 'custom',
      label: copy.customIndicators,
      icon: User,
    })
    return groups
  }, [copy.customIndicators, copy.defaultIndicators, includeDefaults])

  const shouldShowLoadingState = isLoading && !hasIndicators
  const emptyContent = (() => {
    if (!workspaceId) return copy.selectWorkspaceFirst

    if (loadError && !hasIndicators) {
      return (
        <div className='space-y-2 text-xs'>
          <p className='text-destructive'>{loadError}</p>
        </div>
      )
    }

    if (searchQuery.trim()) return copy.noIndicatorsFound
    return copy.noIndicatorsAvailableYet
  })()

  const loadingContent = (
    <div className='flex items-center justify-center gap-1 text-muted-foreground text-xs'>
      <Loader2 className='h-3.5 w-3.5 animate-spin' />
      {copy.loadingIndicators}
    </div>
  )

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const sidebarItems = useMemo<SidebarDropdownItem[]>(
    () =>
      indicatorOptions
        .filter((option) => {
          if (!normalizedSearchQuery) return true
          return option.name.toLowerCase().includes(normalizedSearchQuery)
        })
        .map((option) => ({
          id: option.id,
          groupId: option.source,
          label: option.name,
          selected: selectedIndicatorSet.has(option.id),
          icon: (
            <div
              className='h-5 w-5 rounded-xs p-0.5'
              style={{
                backgroundColor: `${resolveIndicatorColor(option)}20`,
              }}
              aria-hidden='true'
            >
              <Activity
                className='h-4 w-4 text-muted-foreground'
                aria-hidden='true'
                style={{ color: resolveIndicatorColor(option) }}
              />
            </div>
          ),
        })),
    [indicatorOptions, normalizedSearchQuery, selectedIndicatorSet]
  )

  const visibleIndicatorGroups = useMemo(() => {
    if (!normalizedSearchQuery) return indicatorGroups
    const groupIds = new Set(sidebarItems.map((item) => item.groupId))
    return indicatorGroups.filter((group) => groupIds.has(group.id))
  }, [indicatorGroups, normalizedSearchQuery, sidebarItems])

  const displayedActiveFilterId = visibleIndicatorGroups.some(
    (group) => group.id === activeFilterId
  )
    ? activeFilterId
    : (visibleIndicatorGroups[0]?.id ?? null)

  const setOpen = (open: boolean) => {
    setDropdownOpen(open)
    if (open) {
      setActiveFilterId(selectedFilterId)
      return
    }
    setSearchQuery('')
  }

  const triggerValue = dropdownOpen ? searchQuery : hasSelection ? selectionLabel : ''
  const triggerPlaceholder = dropdownOpen ? copy.searchPlaceholder : selectionLabel

  return (
    <Popover open={dropdownOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className='relative inline-flex min-w-[220px]'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Input
                ref={inputRef}
                disabled={isDropdownDisabled}
                value={triggerValue}
                placeholder={triggerPlaceholder}
                className={widgetHeaderControlClassName(
                  cn(
                    'h-7 min-w-[220px] truncate rounded-sm py-1 pr-8 pl-8 font-medium text-sm focus-visible:ring-0 focus-visible:ring-offset-0',
                    !hasSelection && !dropdownOpen && 'text-muted-foreground',
                    triggerClassName
                  )
                )}
                role='combobox'
                aria-expanded={dropdownOpen}
                aria-haspopup='listbox'
                onFocus={() => setOpen(true)}
                onChange={(event) => {
                  setSearchQuery(event.target.value)
                  if (!dropdownOpen) {
                    setOpen(true)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setOpen(false)
                    inputRef.current?.blur()
                  }
                }}
              />
            </TooltipTrigger>
            <TooltipContent side='top'>{tooltipText}</TooltipContent>
          </Tooltip>
          <div className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-1.5 flex'>
            {isLoading ? (
              <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
            ) : (
              colorBadge
            )}
          </div>
          <button
            type='button'
            tabIndex={-1}
            disabled={isDropdownDisabled}
            className='-translate-y-1/2 absolute top-1/2 right-1 flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed'
            onMouseDown={(event) => {
              event.preventDefault()
              if (isDropdownDisabled) return
              const nextOpen = !dropdownOpen
              setOpen(nextOpen)
              if (nextOpen) {
                inputRef.current?.focus()
              } else {
                inputRef.current?.blur()
              }
            }}
            aria-label={dropdownOpen ? 'Close indicators' : 'Open indicators'}
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', dropdownOpen && 'rotate-180')}
              aria-hidden='true'
            />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align='start'
        sideOffset={6}
        className={cn(
          'w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md p-0 shadow-lg',
          menuClassName
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onWheel={(event) => event.stopPropagation()}
      >
        <SidebarDropdownMenuContent
          groups={visibleIndicatorGroups}
          items={sidebarItems}
          activeGroupId={displayedActiveFilterId}
          onActiveGroupChange={(groupId) => setActiveFilterId(groupId as IndicatorFilterId)}
          onSelectItem={(item) => {
            handleToggleIndicator(item.id)
            if (!isMultiSelect) {
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
          loadingContent={shouldShowLoadingState ? loadingContent : null}
          emptyContent={emptyContent}
        />
      </PopoverContent>
    </Popover>
  )
}
