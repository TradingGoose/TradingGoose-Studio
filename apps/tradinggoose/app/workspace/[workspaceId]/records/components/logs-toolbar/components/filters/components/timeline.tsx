import { Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TimeRange } from '@/stores/logs/filters/types'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  logTimeRangeLabelKeys,
  logTimeRangeOptions,
  timelineDropdownListStyle,
} from './shared'

type TimelineProps = {
  variant?: 'default' | 'header'
}

export default function Timeline({ variant = 'default' }: TimelineProps = {}) {
  const t = useTranslations('workspace.logs.dashboard.filters')
  const { timeRange, setTimeRange } = useFilterStore()
  const timeRangeLabel = (range: TimeRange) => t(logTimeRangeLabelKeys[range])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' className={filterButtonClass}>
          {timeRangeLabel(timeRange)}
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
            <span>{timeRangeLabel('All time')}</span>
            {timeRange === 'All time' && <Check className='h-4 w-4 text-muted-foreground' />}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {logTimeRangeOptions.map((range) => (
            <DropdownMenuItem
              key={range}
              onSelect={() => {
                setTimeRange(range)
              }}
              className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <span>{timeRangeLabel(range)}</span>
              {timeRange === range && <Check className='h-4 w-4 text-muted-foreground' />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
