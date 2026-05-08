'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { MonitorReferenceData } from '../shared/types'
import type { ConfigMonitorFilter, ConfigMonitorViewConfig } from '../view/view-config'
import type { ConfigMonitorCard } from './config-card-model'
import { getConfigOutcomeValues, serializeConfigFilters } from './config-query'
import { useConfigSearchState } from './config-search-state'

type ConfigMonitorSearchProps = {
  config: ConfigMonitorViewConfig
  cards: ConfigMonitorCard[]
  referenceData: MonitorReferenceData
  onUpdateConfig: (
    next: ConfigMonitorViewConfig | ((current: ConfigMonitorViewConfig) => ConfigMonitorViewConfig)
  ) => void
}

type Suggestion = {
  label: string
  filter: ConfigMonitorFilter
}

const suggestionKey = (suggestion: Suggestion) => serializeConfigFilters([suggestion.filter])
const filterKey = (filter: ConfigMonitorFilter) => serializeConfigFilters([filter])
const MAX_VISIBLE_SUGGESTIONS = 16

const presenceSuggestionLabels = {
  lastExecutionAt: ['Has last execution', 'No last execution'],
  lastOutcome: ['Has last outcome', 'No last outcome'],
  lastExecutionLogId: ['Has last execution log', 'No last execution log'],
} as const

export function buildConfigSearchSuggestionSet(
  cards: ConfigMonitorCard[],
  referenceData: MonitorReferenceData
): Suggestion[] {
  const suggestions = new Map<string, Suggestion>()
  const add = (suggestion: Suggestion) => suggestions.set(suggestionKey(suggestion), suggestion)

  referenceData.workflowTargets.forEach((target) =>
    add({
      label: target.label,
      filter: {
        field: 'workflowTarget',
        operator: '=',
        values: [`${target.workflowId}:${target.blockId}`],
      },
    })
  )
  referenceData.indicatorOptions.forEach((indicator) =>
    add({
      label: indicator.name,
      filter: { field: 'indicator', operator: '=', values: [indicator.id] },
    })
  )
  referenceData.streamingProviders.forEach((provider) =>
    add({
      label: provider.name,
      filter: { field: 'provider', operator: '=', values: [provider.id] },
    })
  )
  Object.values(referenceData.providerIntervalsByProviderId)
    .flat()
    .forEach((interval) =>
      add({
        label: interval,
        filter: { field: 'interval', operator: '=', values: [interval] },
      })
    )

  cards.forEach((card) => {
    add({
      label: card.workflowTargetLabel,
      filter: { field: 'workflowTarget', operator: '=', values: [card.workflowTargetKey] },
    })
    add({
      label: card.indicatorName,
      filter: { field: 'indicator', operator: '=', values: [card.indicatorId] },
    })
    add({
      label: card.listingLabel,
      filter: { field: 'listing', operator: '=', values: [card.listingValue] },
    })
    add({
      label: card.providerLabel,
      filter: { field: 'provider', operator: '=', values: [card.providerId] },
    })
    add({
      label: card.interval,
      filter: { field: 'interval', operator: '=', values: [card.interval] },
    })
  })

  ;(['active', 'paused'] as const).forEach((status) =>
    add({
      label: status === 'active' ? 'Active monitors' : 'Paused monitors',
      filter: { field: 'status', operator: '=', values: [status] },
    })
  )
  getConfigOutcomeValues().forEach((outcome) =>
    add({
      label: `Last outcome ${outcome}`,
      filter: { field: 'lastOutcome', operator: '=', values: [outcome] },
    })
  )
  Object.entries(presenceSuggestionLabels).forEach(([field, [hasLabel, noLabel]]) => {
    add({
      label: hasLabel,
      filter: { field: field as ConfigMonitorFilter['field'], operator: 'has', values: [] },
    })
    add({
      label: noLabel,
      filter: { field: field as ConfigMonitorFilter['field'], operator: 'no', values: [] },
    })
  })

  return Array.from(suggestions.values())
}

const filterSuggestions = (
  suggestions: Suggestion[],
  rawQuery: string,
  activeFilterKeys: Set<string>
) => {
  const query = rawQuery.trim().toLowerCase()
  return suggestions
    .filter((suggestion) => !activeFilterKeys.has(suggestionKey(suggestion)))
    .filter((suggestion) => {
      if (!query) return true
      return (
        suggestion.label.toLowerCase().includes(query) ||
        suggestionKey(suggestion).toLowerCase().includes(query)
      )
    })
    .slice(0, MAX_VISIBLE_SUGGESTIONS)
}

export function ConfigMonitorSearch({
  config,
  cards,
  referenceData,
  onUpdateConfig,
}: ConfigMonitorSearchProps) {
  const searchState = useConfigSearchState({ config, onUpdateConfig })
  const suggestions = useMemo(
    () => buildConfigSearchSuggestionSet(cards, referenceData),
    [cards, referenceData]
  )
  const activeFilterKeys = useMemo(
    () => new Set(config.quickFilters.map((filter) => filterKey(filter))),
    [config.quickFilters]
  )
  const suggestionLabelByKey = useMemo(
    () => new Map(suggestions.map((suggestion) => [suggestionKey(suggestion), suggestion.label])),
    [suggestions]
  )
  const visibleSuggestions = useMemo(
    () => filterSuggestions(suggestions, searchState.rawQuery, activeFilterKeys),
    [activeFilterKeys, searchState.rawQuery, suggestions]
  )
  const [isOpen, setIsOpen] = useState(false)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const [dropdownWidth, setDropdownWidth] = useState(360)

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

  const clearSearch = useCallback(() => {
    searchState.setRawQuery('')
    onUpdateConfig((current) => ({
      ...current,
      filterQuery: '',
      quickFilters: [],
    }))
    setIsOpen(false)
  }, [onUpdateConfig, searchState])

  const selectSuggestion = useCallback(
    (suggestion: Suggestion) => {
      searchState.toggleQuickFilter(suggestion.filter)
      searchState.setRawQuery('')
      searchState.commitRawQuery('')
      setIsOpen(false)
    },
    [searchState]
  )

  const hasQuery = searchState.rawQuery.trim().length > 0
  const hasQuickFilters = config.quickFilters.length > 0

  return (
    <div className='min-w-0 flex-1'>
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open)
        }}
      >
        <PopoverTrigger asChild>
          <div
            ref={inputContainerRef}
            className='relative flex h-9 w-full items-center rounded-md border border-border bg-background px-2 text-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring'
          >
            <Search className='mr-2 h-4 w-4 shrink-0 text-muted-foreground' />
            <div className='flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              {config.quickFilters.map((filter) => {
                const rawFilter = filterKey(filter)
                return (
                  <Button
                    key={rawFilter}
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-6 shrink-0 gap-1 rounded-sm px-2 text-[11px]'
                    onMouseDown={(event) => {
                      event.preventDefault()
                      searchState.removeFilter(filter)
                    }}
                  >
                    <span>{suggestionLabelByKey.get(rawFilter) ?? rawFilter}</span>
                    <X className='h-3 w-3' />
                  </Button>
                )
              })}
              <input
                value={searchState.rawQuery}
                placeholder={!hasQuickFilters ? 'Search config monitors...' : ''}
                className='h-full min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground'
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                spellCheck='false'
                onFocus={() => setIsOpen(true)}
                onChange={(event) => {
                  searchState.setRawQuery(event.target.value)
                  setIsOpen(true)
                }}
                onBlur={() => searchState.commitRawQuery()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    searchState.commitRawQuery()
                    setIsOpen(false)
                  }
                  if (event.key === 'Escape') {
                    setIsOpen(false)
                  }
                }}
              />
            </div>
            {(hasQuery || hasQuickFilters) && (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='ml-1 h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground'
                onMouseDown={(event) => {
                  event.preventDefault()
                  clearSearch()
                }}
              >
                <X className='h-3.5 w-3.5' />
                <span className='sr-only'>Clear config monitor search</span>
              </Button>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='p-1'
          style={{ width: dropdownWidth }}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className='max-h-[300px] overflow-y-auto'>
            {visibleSuggestions.length > 0 ? (
              <div className='space-y-0.5'>
                <div className='px-2 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
                  Quick filters
                </div>
                {visibleSuggestions.map((suggestion) => (
                  <button
                    key={suggestionKey(suggestion)}
                    type='button'
                    className='flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent'
                    onMouseDown={(event) => {
                      event.preventDefault()
                      selectSuggestion(suggestion)
                    }}
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-medium'>{suggestion.label}</div>
                      <div className='truncate text-muted-foreground text-xs'>
                        {suggestionKey(suggestion)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className='px-2 py-6 text-center text-muted-foreground text-sm'>
                No matching quick filters
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {searchState.invalidTokens.length > 0 ? (
        <p className='mt-1 text-[11px] text-destructive'>
          Invalid config query tokens: {searchState.invalidTokens.join(', ')}
        </p>
      ) : null}
    </div>
  )
}
