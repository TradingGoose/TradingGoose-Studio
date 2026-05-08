'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConfigMonitorFilter, ConfigMonitorViewConfig } from '../view/view-config'
import { parseConfigQuery, serializeConfigFilters } from './config-query'

export function useConfigSearchState({
  config,
  onUpdateConfig,
}: {
  config: ConfigMonitorViewConfig
  onUpdateConfig: (
    next: ConfigMonitorViewConfig | ((current: ConfigMonitorViewConfig) => ConfigMonitorViewConfig)
  ) => void
}) {
  const [rawQuery, setRawQuery] = useState(config.filterQuery)
  const parsed = useMemo(() => parseConfigQuery(rawQuery), [rawQuery])

  useEffect(() => {
    setRawQuery(config.filterQuery)
  }, [config.filterQuery])

  const commitRawQuery = useCallback(
    (nextQuery = rawQuery) => {
      onUpdateConfig((current) => ({
        ...current,
        filterQuery: nextQuery.trim(),
      }))
    },
    [onUpdateConfig, rawQuery]
  )

  const toggleQuickFilter = useCallback(
    (filter: ConfigMonitorFilter) => {
      onUpdateConfig((current) => {
        const raw = serializeConfigFilters([filter])
        const nextQuickFilters = current.quickFilters.filter(
          (entry) => serializeConfigFilters([entry]) !== raw
        )
        const removed = nextQuickFilters.length !== current.quickFilters.length

        return {
          ...current,
          quickFilters: removed ? nextQuickFilters : nextQuickFilters.concat(filter),
        }
      })
    },
    [onUpdateConfig]
  )

  const removeFilter = useCallback(
    (filter: ConfigMonitorFilter) => {
      const raw = serializeConfigFilters([filter])
      onUpdateConfig((current) => ({
        ...current,
        quickFilters: current.quickFilters.filter(
          (entry) => serializeConfigFilters([entry]) !== raw
        ),
      }))
    },
    [onUpdateConfig]
  )

  return {
    rawQuery,
    parsedFilters: parsed.filters,
    invalidTokens: parsed.invalidTokens,
    setRawQuery,
    commitRawQuery,
    toggleQuickFilter,
    removeFilter,
  }
}
