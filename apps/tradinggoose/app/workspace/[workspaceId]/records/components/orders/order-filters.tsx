'use client'

import { useId } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTranslations } from 'next-intl'
import {
  DEFAULT_ORDERS_FILTER_STATE,
  ORDER_ENVIRONMENT_FILTER_VALUES,
  ORDER_LINKED_LOG_FILTER_VALUES,
  ORDER_PROVIDER_FILTER_VALUES,
  ORDER_SIDE_FILTER_VALUES,
  ORDER_SORT_BY_VALUES,
  ORDER_SORT_ORDER_VALUES,
  ORDER_STATUS_FILTER_VALUES,
  ORDER_SUBMISSION_SOURCE_FILTER_VALUES,
  ORDER_TIME_IN_FORCE_FILTER_VALUES,
  ORDER_TYPE_FILTER_VALUES,
  type OrdersFilterState,
} from '@/lib/records/order-filters'
import { cn } from '@/lib/utils'
import { titleCase, uppercase } from './order-formatters'

type OrderFiltersProps = {
  searchValue: string
  onSearchChange: (value: string) => void
}

type OrderFilterMenuProps = {
  state: OrdersFilterState
  searchValue: string
  loadedCount: number
  totalCount: number
  onChange: (patch: Partial<OrdersFilterState>) => void
  onReset: () => void
}

const isDefault = (state: OrdersFilterState) =>
  (Object.keys(DEFAULT_ORDERS_FILTER_STATE) as Array<keyof OrdersFilterState>).every(
    (key) => state[key] === DEFAULT_ORDERS_FILTER_STATE[key]
  )

const selectValue = (value: string) => value || 'all'
const selectedValue = (value: string) => (value === 'all' ? '' : value)
const timeInForceLabel = (value: string) =>
  value === 'extended_hours' ? 'Extended Hours' : uppercase(value)

const filterCountKeys = [
  'provider',
  'environment',
  'submissionSource',
  'status',
  'side',
  'orderType',
  'timeInForce',
  'linkedLog',
  'startDate',
  'endDate',
] as const satisfies readonly (keyof OrdersFilterState)[]

const activeFilterCount = (state: OrdersFilterState) => {
  const dimensionCount = filterCountKeys.filter(
    (key) => state[key] !== DEFAULT_ORDERS_FILTER_STATE[key]
  ).length
  const sortChanged =
    state.orderSortBy !== DEFAULT_ORDERS_FILTER_STATE.orderSortBy ||
    state.orderSortOrder !== DEFAULT_ORDERS_FILTER_STATE.orderSortOrder

  return dimensionCount + (sortChanged ? 1 : 0)
}

const datetimeLocalValue = (value: string) => {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}

const fromDatetimeLocal = (value: string) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function FilterSelect({
  value,
  onValueChange,
  label,
  placeholder,
  options,
  className,
  labelFor,
}: {
  value: string
  onValueChange: (value: string) => void
  label: string
  placeholder: string
  options: readonly string[]
  className?: string
  labelFor?: (value: string) => string
}) {
  return (
    <div className='min-w-0 space-y-1.5'>
      <div className='font-medium text-muted-foreground text-xs'>{label}</div>
      <Select
        value={selectValue(value)}
        onValueChange={(next) => onValueChange(selectedValue(next))}
      >
        <SelectTrigger
          aria-label={label}
          className={cn('h-9 min-w-0 rounded-md bg-background', className)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option || 'all'} value={option || 'all'}>
              {option ? (labelFor?.(option) ?? titleCase(option)) : placeholder}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function OrderFilters({ searchValue, onSearchChange }: OrderFiltersProps) {
  const t = useTranslations('workspace.records.orders')
  return (
    <div className='flex min-w-0 flex-1'>
      <div className='relative min-w-[160px] flex-1'>
        <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground' />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('searchPlaceholder')}
          className='h-9 rounded-md bg-background pl-9'
        />
      </div>
    </div>
  )
}

export function OrderFilterMenu({
  state,
  searchValue,
  loadedCount,
  totalCount,
  onChange,
  onReset,
}: OrderFilterMenuProps) {
  const t = useTranslations('workspace.records.orders')
  const hasFilters = !isDefault(state) || searchValue.trim() !== state.orderSearch
  const advancedFilterCount = activeFilterCount(state)
  const startDateId = useId()
  const endDateId = useId()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant={advancedFilterCount ? 'secondary' : 'outline'}
          size='sm'
          className='h-9 shrink-0 rounded-md px-3'
          aria-label={t('filters')}
        >
          <SlidersHorizontal className='h-4 w-4' />
          <span className='hidden lg:inline'>{t('filters')}</span>
          {advancedFilterCount ? (
            <Badge
              variant='outline'
              className='ml-0.5 h-5 min-w-[1.25rem] justify-center rounded-sm px-1.5 text-[10px]'
            >
              {advancedFilterCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[360px] p-0' align='end'>
        <div className='flex items-center justify-between gap-3 border-b px-4 py-3'>
          <div>
            <div className='font-medium text-sm'>{t('orderFilters')}</div>
            <div className='text-muted-foreground text-xs'>
              {t('showingOf', { loadedCount, totalCount })}
            </div>
          </div>
          {hasFilters ? (
            <Button variant='ghost' size='sm' className='h-8 gap-2' onClick={onReset}>
              <X className='h-4 w-4' />
              {t('clear')}
            </Button>
          ) : null}
        </div>

        <div className='grid max-h-[min(70vh,560px)] grid-cols-2 gap-3 overflow-y-auto p-4'>
          <FilterSelect
            value={state.provider}
            onValueChange={(provider) =>
              onChange({ provider: provider as OrdersFilterState['provider'] })
            }
            label={t('provider')}
            placeholder={t('allProviders')}
            options={ORDER_PROVIDER_FILTER_VALUES}
            labelFor={titleCase}
          />
          <FilterSelect
            value={state.environment}
            onValueChange={(environment) =>
              onChange({ environment: environment as OrdersFilterState['environment'] })
            }
            label={t('environment')}
            placeholder={t('allEnvironments')}
            options={ORDER_ENVIRONMENT_FILTER_VALUES}
            labelFor={titleCase}
          />
          <FilterSelect
            value={state.submissionSource}
            onValueChange={(submissionSource) =>
              onChange({
                submissionSource: submissionSource as OrdersFilterState['submissionSource'],
              })
            }
            label={t('submissionSource')}
            placeholder={t('allSources')}
            options={ORDER_SUBMISSION_SOURCE_FILTER_VALUES}
            labelFor={titleCase}
          />
          <FilterSelect
            value={state.status}
            onValueChange={(status) => onChange({ status: status as OrdersFilterState['status'] })}
            label={t('status')}
            placeholder={t('allStatuses')}
            options={ORDER_STATUS_FILTER_VALUES}
            labelFor={titleCase}
          />
          <FilterSelect
            value={state.side}
            onValueChange={(side) => onChange({ side: side as OrdersFilterState['side'] })}
            label={t('side')}
            placeholder={t('allSides')}
            options={ORDER_SIDE_FILTER_VALUES}
            labelFor={titleCase}
          />
          <FilterSelect
            value={state.orderType}
            onValueChange={(orderType) =>
              onChange({ orderType: orderType as OrdersFilterState['orderType'] })
            }
            label={t('orderType')}
            placeholder={t('allOrderTypes')}
            options={ORDER_TYPE_FILTER_VALUES}
            labelFor={titleCase}
          />
          <FilterSelect
            value={state.timeInForce}
            onValueChange={(timeInForce) =>
              onChange({ timeInForce: timeInForce as OrdersFilterState['timeInForce'] })
            }
            label={t('timeInForce')}
            placeholder={t('allTimeInForce')}
            options={ORDER_TIME_IN_FORCE_FILTER_VALUES}
            labelFor={timeInForceLabel}
          />
          <FilterSelect
            value={state.linkedLog}
            onValueChange={(linkedLog) =>
              onChange({ linkedLog: linkedLog as OrdersFilterState['linkedLog'] })
            }
            label={t('logLink')}
            placeholder={t('anyLogLink')}
            options={ORDER_LINKED_LOG_FILTER_VALUES}
            labelFor={(value) => (value === 'true' ? t('linked') : t('unlinked'))}
          />
          <FilterSelect
            value={state.orderSortBy}
            onValueChange={(orderSortBy) =>
              onChange({ orderSortBy: orderSortBy as OrdersFilterState['orderSortBy'] })
            }
            label={t('sortField')}
            placeholder={t('sortField')}
            options={ORDER_SORT_BY_VALUES}
            labelFor={titleCase}
          />
          <FilterSelect
            value={state.orderSortOrder}
            onValueChange={(orderSortOrder) =>
              onChange({
                orderSortOrder: orderSortOrder as OrdersFilterState['orderSortOrder'],
              })
            }
            label={t('sortOrder')}
            placeholder={t('sortOrder')}
            options={ORDER_SORT_ORDER_VALUES}
            labelFor={uppercase}
          />

          <label htmlFor={startDateId} className='min-w-0 space-y-1.5'>
            <span className='block font-medium text-muted-foreground text-xs'>{t('from')}</span>
            <Input
              id={startDateId}
              type='datetime-local'
              value={datetimeLocalValue(state.startDate)}
              onChange={(event) => onChange({ startDate: fromDatetimeLocal(event.target.value) })}
              className='h-9 rounded-md bg-background'
            />
          </label>
          <label htmlFor={endDateId} className='min-w-0 space-y-1.5'>
            <span className='block font-medium text-muted-foreground text-xs'>{t('to')}</span>
            <Input
              id={endDateId}
              type='datetime-local'
              value={datetimeLocalValue(state.endDate)}
              onChange={(event) => onChange({ endDate: fromDatetimeLocal(event.target.value) })}
              className='h-9 rounded-md bg-background'
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  )
}
