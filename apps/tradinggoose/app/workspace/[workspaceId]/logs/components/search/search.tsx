'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { parseQuery, type ParsedFilter } from '@/lib/logs/query-parser'
import {
  type FolderData,
  SearchSuggestions,
  type WorkflowData,
} from '@/lib/logs/search-suggestions'
import { cn } from '@/lib/utils'
import { useSearchState } from '@/app/workspace/[workspaceId]/logs/hooks/use-search-state'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface AutocompleteSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  availableWorkflows?: string[]
  availableFolders?: string[]
  className?: string
  onOpenChange?: (open: boolean) => void
  showActiveFilters?: boolean
  showTextSearchIndicator?: boolean
}

export function AutocompleteSearch({
  value,
  onChange,
  placeholder = 'Search logs...',
  availableWorkflows = [],
  availableFolders = [],
  className,
  onOpenChange,
  showActiveFilters = true,
  showTextSearchIndicator = true,
}: AutocompleteSearchProps) {
  const workflows = useWorkflowRegistry((state) => state.workflows)
  const folders = useFolderStore((state) => state.folders)

  const fallbackWorkflowData = useMemo<WorkflowData[]>(() => {
    return availableWorkflows.map((name, index) => ({
      id: `external-workflow-${index}-${name}`,
      name,
    }))
  }, [availableWorkflows])

  const fallbackFolderData = useMemo<FolderData[]>(() => {
    return availableFolders.map((name, index) => ({
      id: `external-folder-${index}-${name}`,
      name,
    }))
  }, [availableFolders])

  const storeWorkflowData = useMemo<WorkflowData[]>(() => {
    return Object.values(workflows)
      .filter((workflow) => workflow?.name)
      .map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
      }))
  }, [workflows])

  const storeFolderData = useMemo<FolderData[]>(() => {
    return Object.values(folders).map((folder) => ({
      id: folder.id,
      name: folder.name,
    }))
  }, [folders])

  const workflowsData =
    storeWorkflowData.length > 0 ? storeWorkflowData : fallbackWorkflowData
  const foldersData = storeFolderData.length > 0 ? storeFolderData : fallbackFolderData

  const suggestionEngine = useMemo(() => {
    return new SearchSuggestions(workflowsData, foldersData)
  }, [workflowsData, foldersData])

  const handleFiltersChange = useCallback((_filters: ParsedFilter[], _textSearch: string) => {
    // State synchronization handled by effects below
  }, [])

  const {
    appliedFilters,
    currentInput,
    textSearch,
    isOpen,
    suggestions,
    sections,
    highlightedIndex,
    highlightedBadgeIndex,
    inputRef,
    dropdownRef,
    handleInputChange,
    handleSuggestionSelect,
    handleKeyDown,
    handleFocus,
    handleBlur,
    removeBadge,
    clearAll,
    initializeFromQuery,
    setHighlightedIndex,
  } = useSearchState({
    onFiltersChange: handleFiltersChange,
    getSuggestions: (input) => suggestionEngine.getSuggestions(input),
  })

  const lastSyncedQueryRef = useRef(value)
  const applyQueryToState = useCallback(
    (query: string) => {
      const parsed = parseQuery(query)
      initializeFromQuery(parsed.textSearch, parsed.filters)
    },
    [initializeFromQuery]
  )

  useEffect(() => {
    const nextQuery = buildQueryString(appliedFilters, textSearch, currentInput)
    if (nextQuery === value) {
      lastSyncedQueryRef.current = value
      return
    }
    lastSyncedQueryRef.current = nextQuery
    onChange(nextQuery)
  }, [appliedFilters, textSearch, currentInput, value, onChange])

  useEffect(() => {
    if (value === lastSyncedQueryRef.current) {
      return
    }
    applyQueryToState(value)
  }, [value, applyQueryToState])

  useEffect(() => {
    onOpenChange?.(isOpen)
  }, [isOpen, onOpenChange])

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return
    const container = dropdownRef.current
    const optionEl = container?.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`)
    if (optionEl) {
      try {
        optionEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      } catch {
        optionEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [isOpen, highlightedIndex, dropdownRef])

  const inputContainerRef = useRef<HTMLDivElement>(null)
  const [dropdownWidth, setDropdownWidth] = useState(500)
  useEffect(() => {
    const measure = () => {
      if (inputContainerRef.current) {
        setDropdownWidth(inputContainerRef.current.offsetWidth)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const hasFilters = appliedFilters.length > 0
  const hasTextSearch = textSearch.length > 0
  const suggestionType =
    sections.length > 0 ? 'multi-section' : suggestions.length > 0 ? suggestions[0]?.category : null

  const handleTextSearchClear = () => {
    initializeFromQuery('', appliedFilters.slice())
  }

  return (
    <div className={cn('relative', className)}>
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setHighlightedIndex(-1)
          }
        }}
      >
        <PopoverTrigger asChild>
          <div
            ref={inputContainerRef}
            className='relative flex h-9 w-full items-center rounded-md border border-border bg-card/60 px-2 text-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring'
          >
            <Search className='mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
            <div className='flex flex-1 items-center gap-1.5 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              {appliedFilters.map((filter, index) => (
                <Button
                  key={`${filter.field}-${filter.value}-${index}`}
                  variant='outline'
                  size='sm'
                  className={cn(
                    'h-6 flex-shrink-0 gap-1 rounded-sm px-2 text-[11px]',
                    highlightedBadgeIndex === index && 'border-ring text-foreground'
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    removeBadge(index)
                  }}
                >
                  <span className='text-muted-foreground'>{filter.field}:</span>
                  <span className='text-foreground'>
                    {filter.operator !== '=' && filter.operator}
                    {filter.originalValue}
                  </span>
                  <X className='h-3 w-3' />
                </Button>
              ))}

              {hasTextSearch && (
                <Button
                  variant='outline'
                  size='sm'
                  className='h-6 flex-shrink-0 gap-1 rounded-sm px-2 text-[11px]'
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleTextSearchClear()
                  }}
                >
                  <span className='text-foreground'>
                    &quot;
                    {textSearch}
                    &quot;
                  </span>
                  <X className='h-3 w-3' />
                </Button>
              )}

              <input
                ref={inputRef}
                type='text'
                placeholder={hasFilters || hasTextSearch ? '' : placeholder}
                value={currentInput}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                onBlur={handleBlur}
                className='min-w-[120px] flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'
              />
            </div>

            {(hasFilters || hasTextSearch) && (
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='ml-1 h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground'
                onMouseDown={(e) => {
                  e.preventDefault()
                  clearAll()
                }}
              >
                <X className='h-4 w-4' />
              </Button>
            )}
          </div>
        </PopoverTrigger>

        {suggestions.length > 0 && (
          <PopoverContent
            className='p-0'
            style={{ width: dropdownWidth }}
            align='start'
            sideOffset={4}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div ref={dropdownRef} className='max-h-96 overflow-y-auto'>
              {sections.length > 0 ? (
                <div className='py-1'>
                  {suggestions[0]?.category === 'show-all' && (
                    <button
                      key={suggestions[0].id}
                      data-index={0}
                      className={cn(
                        'w-full px-3 py-1.5 text-left text-sm transition-colors',
                        highlightedIndex === 0
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-card hover:text-foreground'
                      )}
                      onMouseEnter={() => setHighlightedIndex(0)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSuggestionSelect(suggestions[0])
                      }}
                    >
                      {suggestions[0].label}
                    </button>
                  )}

                  {sections.map((section) => (
                    <div key={section.title}>
                      <div className='border-t border-border/50 px-3 py-1.5 font-medium text-[11px] uppercase tracking-wide text-muted-foreground/80'>
                        {section.title}
                      </div>
                      {section.suggestions.map((suggestion) => {
                        if (suggestion.category === 'show-all') return null
                        const index = suggestions.indexOf(suggestion)
                        const isHighlighted = index === highlightedIndex

                        return (
                          <button
                            key={suggestion.id}
                            data-index={index}
                            className={cn(
                              'w-full px-3 py-1.5 text-left text-sm transition-colors',
                              isHighlighted
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-card hover:text-foreground'
                            )}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              handleSuggestionSelect(suggestion)
                            }}
                          >
                            <div className='flex items-center justify-between gap-3'>
                              <div className='min-w-0 flex-1 truncate'>{suggestion.label}</div>
                              {suggestion.value !== suggestion.label && (
                                <div className='flex-shrink-0 font-mono text-[11px] text-muted-foreground'>
                                  {suggestion.category === 'workflow' ||
                                  suggestion.category === 'folder'
                                    ? `${suggestion.category}:`
                                    : ''}
                                </div>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className='py-1'>
                  {suggestionType === 'filters' && (
                    <div className='border-b border-border/50 px-3 py-1.5 font-medium text-[11px] uppercase tracking-wide text-muted-foreground/80'>
                      Suggested Filters
                    </div>
                  )}

                  {suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.id}
                      data-index={index}
                      className={cn(
                        'w-full px-3 py-1.5 text-left text-sm transition-colors',
                        index === highlightedIndex
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-card hover:text-foreground'
                      )}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSuggestionSelect(suggestion)
                      }}
                    >
                      <div className='flex items-center justify-between gap-3'>
                        <div className='min-w-0 flex-1'>{suggestion.label}</div>
                        {suggestion.description && (
                          <div className='flex-shrink-0 font-mono text-[11px] text-muted-foreground'>
                            {suggestion.value}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </PopoverContent>
        )}
      </Popover>

      {showActiveFilters && hasFilters && (
        <div className='mt-3 flex flex-wrap items-center gap-2'>
          <span className='font-medium text-xs text-muted-foreground'>Active Filters:</span>
          {appliedFilters.map((filter, index) => (
            <Badge
              key={`${filter.field}-${filter.value}-${index}`}
              variant='secondary'
              className='h-6 border border-border/50 bg-muted/50 font-mono text-xs text-muted-foreground'
            >
              <span className='mr-1'>{filter.field}:</span>
              <span>
                {filter.operator !== '=' && filter.operator}
                {filter.originalValue}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='ml-1 h-3 w-3 p-0 text-muted-foreground hover:bg-card/50 hover:text-foreground'
                onMouseDown={(e) => {
                  e.preventDefault()
                  removeBadge(index)
                }}
              >
                <X className='h-2.5 w-2.5' />
              </Button>
            </Badge>
          ))}
          {appliedFilters.length > 1 && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-6 text-xs text-muted-foreground hover:text-foreground'
              onMouseDown={(e) => {
                e.preventDefault()
                initializeFromQuery(textSearch, [])
              }}
            >
              Clear all
            </Button>
          )}
        </div>
      )}

      {showTextSearchIndicator && hasTextSearch && (
        <div className='mt-2 flex items-center gap-2'>
          <span className='font-medium text-xs text-muted-foreground'>Text Search:</span>
          <Badge variant='outline' className='text-xs'>
            &quot;{textSearch}&quot;
          </Badge>
        </div>
      )}
    </div>
  )
}

function buildQueryString(filters: ParsedFilter[], textSearch: string, currentInput: string) {
  const filterStrings = filters.map(
    (filter) => `${filter.field}:${filter.operator !== '=' ? filter.operator : ''}${filter.originalValue}`
  )
  const parts = [...filterStrings]

  if (textSearch.trim()) {
    parts.push(textSearch.trim())
  }

  if (currentInput.trim()) {
    parts.push(currentInput)
  }

  return parts.join(' ').trim()
}
