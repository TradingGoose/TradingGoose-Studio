'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { fetchTimeZoneOptions } from '@/components/timezone-selector/fetchers'
import { cn } from '@/lib/utils'
import { formatMonitorTimezoneLabel } from '../shared/monitor-time'
import { monitorControlSurfaceClass } from '../shared/monitor-ui'
import { SearchableDropdown, type SearchableDropdownOption } from '../shared/searchable-dropdown'
import { DEFAULT_MONITOR_TIMEZONE } from '../view/view-config'

type TimeZoneOption = Awaited<ReturnType<typeof fetchTimeZoneOptions>>[number]
type TimeZoneDropdownOption = SearchableDropdownOption & {
  name: string
  rightLabel?: string
}

const UTC_TIMEZONE_OPTION: TimeZoneDropdownOption = {
  value: DEFAULT_MONITOR_TIMEZONE,
  name: DEFAULT_MONITOR_TIMEZONE,
  label: 'UTC',
  searchValue: 'UTC Coordinated Universal Time UTC+00:00',
}

type MonitorTimezoneMenuProps = {
  timezone: string
  disabled?: boolean
  className?: string
  onTimezoneChange: (timezone: string) => void
}

export function MonitorTimezoneMenu({
  timezone,
  disabled,
  className,
  onTimezoneChange,
}: MonitorTimezoneMenuProps) {
  const [options, setOptions] = useState<TimeZoneOption[]>([])
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const selectedTimezone = timezone.trim() || DEFAULT_MONITOR_TIMEZONE
  const dropdownOptions = useMemo<TimeZoneDropdownOption[]>(
    () => [
      UTC_TIMEZONE_OPTION,
      ...options
        .filter((option) => option.name !== DEFAULT_MONITOR_TIMEZONE)
        .map((option) => ({
          value: option.name,
          name: option.name,
          label: option.label,
          rightLabel: option.rightLabel,
          searchValue: option.searchLabel ?? `${option.label} ${option.name}`,
        })),
    ],
    [options]
  )
  const selectedOption = useMemo(
    () => dropdownOptions.find((option) => option.name === selectedTimezone) ?? null,
    [dropdownOptions, selectedTimezone]
  )
  const selectedLabel = selectedOption?.label ?? formatMonitorTimezoneLabel(selectedTimezone)

  const loadTimezones = useCallback(() => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    fetchTimeZoneOptions()
      .then((data) => setOptions(data))
      .catch((error) => {
        console.error('Failed to load monitor timezones', error)
      })
      .finally(() => {
        loadingRef.current = false
        setLoading(false)
      })
  }, [])

  const handleOpenChange = (open: boolean) => {
    if (open) {
      if (options.length === 0) {
        loadTimezones()
      }
    }
  }

  return (
    <SearchableDropdown
      value={selectedTimezone}
      options={dropdownOptions}
      placeholder='UTC'
      searchPlaceholder='Search timezones...'
      emptyText={loading ? 'Loading timezones...' : 'No timezones found.'}
      disabled={disabled}
      triggerClassName={cn(monitorControlSurfaceClass, className)}
      triggerLabel={`Timezone: ${selectedLabel}`}
      onOpenChange={handleOpenChange}
      onValueChange={onTimezoneChange}
      renderTriggerValue={() => (
        <div className='flex shrink-0 items-center gap-2'>
          <span className='shrink-0 text-muted-foreground text-xs'>Timezone</span>
          <span className='shrink-0 text-foreground'>{selectedLabel}</span>
        </div>
      )}
      renderOption={(option) => (
        <>
          <span className='truncate'>{option.label}</span>
          {option.rightLabel ? (
            <span className='ml-auto text-[10px] text-muted-foreground'>{option.rightLabel}</span>
          ) : null}
        </>
      )}
      footer={
        loading ? (
          <div className='px-2 py-2 text-center text-muted-foreground text-sm'>
            Loading timezones...
          </div>
        ) : null
      }
    />
  )
}
