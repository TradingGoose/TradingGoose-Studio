'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Check, ClockFading } from 'lucide-react'
import { fetchTimeZoneOptions } from '@/components/timezone-selector/fetchers'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatMonitorTimezoneLabel } from '../shared/monitor-time'
import { DEFAULT_MONITOR_TIMEZONE } from '../view/view-config'

type TimeZoneOption = Awaited<ReturnType<typeof fetchTimeZoneOptions>>[number]

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
  const [search, setSearch] = useState('')
  const loadingRef = useRef(false)
  const selectedTimezone = timezone.trim() || DEFAULT_MONITOR_TIMEZONE
  const selectedOption = useMemo(
    () => options.find((option) => option.name === selectedTimezone) ?? null,
    [options, selectedTimezone]
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
      return
    }

    setSearch('')
  }

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options

    return options.filter((option) => {
      const label = option.label.toLowerCase()
      const name = option.name.toLowerCase()
      const searchLabel = option.searchLabel?.toLowerCase() ?? ''
      return label.includes(query) || name.includes(query) || searchLabel.includes(query)
    })
  }, [options, search])

  return (
    <DropdownMenu onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className={cn('h-8 shrink-0 gap-2 rounded-md', className)}
          disabled={disabled}
        >
          <ClockFading className='h-4 w-4' />
          <span>Timezone</span>
          <span className='max-w-[150px] truncate text-muted-foreground'>{selectedLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-[280px] p-0'>
        <div className='border-b p-2'>
          <Input
            placeholder='Search timezones...'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='h-8'
          />
        </div>
        <div className='max-h-72 overflow-y-auto p-1' style={{ scrollbarWidth: 'thin' }}>
          <DropdownMenuItem
            onSelect={() => onTimezoneChange(DEFAULT_MONITOR_TIMEZONE)}
            className='cursor-pointer'
          >
            <span className='truncate'>UTC</span>
            {selectedTimezone === DEFAULT_MONITOR_TIMEZONE ? (
              <Check className='ml-auto h-3.5 w-3.5 text-primary' />
            ) : null}
          </DropdownMenuItem>
          {loading ? (
            <DropdownMenuItem disabled className='justify-center text-muted-foreground'>
              Loading timezones...
            </DropdownMenuItem>
          ) : filteredOptions.length === 0 ? (
            <DropdownMenuItem disabled className='justify-center text-muted-foreground'>
              No timezones found.
            </DropdownMenuItem>
          ) : (
            filteredOptions.map((option) => {
              const isSelected = option.name === selectedTimezone

              return (
                <DropdownMenuItem
                  key={option.id}
                  onSelect={() => onTimezoneChange(option.name)}
                  className='cursor-pointer gap-2'
                >
                  <span className='truncate'>{option.label}</span>
                  {option.rightLabel ? (
                    <span className='ml-auto text-[10px] text-muted-foreground'>
                      {option.rightLabel}
                    </span>
                  ) : null}
                  {isSelected ? <Check className='h-3.5 w-3.5 text-primary' /> : null}
                </DropdownMenuItem>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
