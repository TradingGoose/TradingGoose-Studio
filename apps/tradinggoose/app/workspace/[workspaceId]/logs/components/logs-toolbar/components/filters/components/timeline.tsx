import { Check, ChevronDown } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  timelineDropdownListStyle,
} from './shared'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TimeRange } from '@/stores/logs/filters/types'

type TimelineProps = {
  variant?: 'default' | 'header'
}

export default function Timeline({ variant = 'default' }: TimelineProps = {}) {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.logs.dashboard.filters
  const { timeRange, setTimeRange } = useFilterStore()
  const specificTimeRanges: TimeRange[] = [
    'Past 30 minutes',
    'Past hour',
    'Past 6 hours',
    'Past 12 hours',
    'Past 24 hours',
    'Past 3 days',
    'Past 7 days',
    'Past 14 days',
    'Past 30 days',
  ]

  const timelineLabels: Record<TimeRange, string> = {
    'All time': copy.allTime,
    'Past 30 minutes': copy.past30Minutes,
    'Past hour': copy.pastHour,
    'Past 6 hours': copy.past6Hours,
    'Past 12 hours': copy.past12Hours,
    'Past 24 hours': copy.past24Hours,
    'Past 3 days': copy.past3Days,
    'Past 7 days': copy.past7Days,
    'Past 14 days': copy.past14Days,
    'Past 30 days': copy.past30Days,
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' className={filterButtonClass}>
          {timelineLabels[timeRange] ?? timeRange}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'header' ? 'end' : 'start'}
        side='bottom'
        avoidCollisions={false}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <div
          className={`${commandListClass} py-1`}
          style={variant === 'header' ? undefined : timelineDropdownListStyle}
        >
          <DropdownMenuItem
            key='all'
            onSelect={() => {
              setTimeRange('All time')
            }}
            className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <span>{copy.allTime}</span>
            {timeRange === 'All time' && <Check className='h-4 w-4 text-muted-foreground' />}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {specificTimeRanges.map((range) => (
            <DropdownMenuItem
              key={range}
              onSelect={() => {
                setTimeRange(range)
              }}
              className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <span>{timelineLabels[range] ?? range}</span>
              {timeRange === range && <Check className='h-4 w-4 text-muted-foreground' />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
