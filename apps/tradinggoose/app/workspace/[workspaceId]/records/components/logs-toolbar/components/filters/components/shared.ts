import type { LogLevel, TimeRange, TriggerType } from '@/stores/logs/filters/types'

export const filterButtonClass =
  'inline-flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-[#E5E5E5] bg-background px-3 font-normal text-sm text-foreground transition-colors ring-offset-background hover:bg-card hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 dark:border-[#414141]'

export const dropdownContentClass =
  'w-[200px] rounded-sm border-border bg-background p-0 shadow-xs '

export const commandListClass = 'overflow-y-auto overflow-x-hidden'

export const workflowDropdownListStyle = {
  maxHeight: '14rem',
  overflowY: 'auto',
  overflowX: 'hidden',
} as const

export const folderDropdownListStyle = {
  maxHeight: '10rem',
  overflowY: 'auto',
  overflowX: 'hidden',
} as const

export const triggerDropdownListStyle = {
  maxHeight: '7.5rem',
  overflowY: 'auto',
  overflowX: 'hidden',
} as const

export const timelineDropdownListStyle = {
  maxHeight: '9rem',
  overflowY: 'auto',
  overflowX: 'hidden',
} as const

export const logLevelOptions = [
  { value: 'error', labelKey: 'error', color: 'bg-destructive/100' },
  { value: 'info', labelKey: 'info', color: 'bg-muted-foreground/100' },
] as const satisfies readonly { value: LogLevel; labelKey: 'error' | 'info'; color: string }[]

export const logTriggerOptions = [
  { value: 'manual', labelKey: 'manual', color: '#9ca3af', colorClass: 'bg-gray-500' },
  { value: 'api', labelKey: 'api', color: '#3b82f6', colorClass: 'bg-blue-500' },
  { value: 'webhook', labelKey: 'webhook', color: '#f97316', colorClass: 'bg-orange-500' },
  { value: 'schedule', labelKey: 'schedule', color: '#10b981', colorClass: 'bg-green-500' },
  { value: 'chat', labelKey: 'chat', color: '#8b5cf6', colorClass: 'bg-amber-500' },
] as const satisfies readonly {
  value: TriggerType
  labelKey: 'api' | 'chat' | 'manual' | 'schedule' | 'webhook'
  color: string
  colorClass: string
}[]

export const logTimeRangeOptions: TimeRange[] = [
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

export const logTimeRangeLabelKeys = {
  'All time': 'allTime',
  'Past 30 minutes': 'past30Minutes',
  'Past hour': 'pastHour',
  'Past 6 hours': 'past6Hours',
  'Past 12 hours': 'past12Hours',
  'Past 24 hours': 'past24Hours',
  'Past 3 days': 'past3Days',
  'Past 7 days': 'past7Days',
  'Past 14 days': 'past14Days',
  'Past 30 days': 'past30Days',
} as const satisfies Record<TimeRange, string>

export const getLogLevelOption = (level: string | null | undefined) =>
  logLevelOptions.find((option) => option.value === level?.toLowerCase())

export const getLogTriggerOption = (trigger: string | null | undefined) =>
  logTriggerOptions.find((option) => option.value === trigger?.toLowerCase())

export const getLogTriggerColor = (trigger: string | null | undefined) =>
  getLogTriggerOption(trigger)?.color ?? '#9ca3af'
