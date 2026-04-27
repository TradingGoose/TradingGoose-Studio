'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

  return (
    <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
      <Input
        value={searchState.rawQuery}
        placeholder='Search config monitors...'
        className='h-9'
        onChange={(event) => searchState.setRawQuery(event.target.value)}
        onBlur={() => searchState.commitRawQuery()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            searchState.commitRawQuery()
          }
        }}
      />
      <div className='flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {config.quickFilters.map((filter) => (
          <Button
            key={serializeConfigFilters([filter])}
            type='button'
            variant='secondary'
            size='sm'
            className='h-6 shrink-0 px-2 text-[11px]'
            onClick={() => searchState.removeFilter(filter)}
          >
            {serializeConfigFilters([filter])} x
          </Button>
        ))}
        {suggestions.map((suggestion) => (
          <Button
            key={suggestionKey(suggestion)}
            type='button'
            variant='outline'
            size='sm'
            className='h-6 shrink-0 px-2 text-[11px]'
            onClick={() => searchState.toggleQuickFilter(suggestion.filter)}
          >
            {suggestion.label}
          </Button>
        ))}
      </div>
      {searchState.invalidTokens.length > 0 ? (
        <p className='text-[11px] text-destructive'>
          Invalid config query tokens: {searchState.invalidTokens.join(', ')}
        </p>
      ) : null}
    </div>
  )
}
