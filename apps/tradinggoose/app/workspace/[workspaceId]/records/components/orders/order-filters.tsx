'use client'

import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  state: OrdersFilterState
  searchValue: string
  loadedCount: number
  totalCount: number
  onSearchChange: (value: string) => void
  onChange: (patch: Partial<OrdersFilterState>) => void
  onReset: () => void
}

const isDefault = (state: OrdersFilterState) =>
  (Object.keys(DEFAULT_ORDERS_FILTER_STATE) as Array<keyof OrdersFilterState>).every(
    (key) => state[key] === DEFAULT_ORDERS_FILTER_STATE[key]
  )

const selectValue = (value: string) => value || 'all'
const selectedValue = (value: string) => (value === 'all' ? '' : value)

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
  placeholder,
  options,
  className,
  labelFor,
}: {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  options: readonly string[]
  className?: string
  labelFor?: (value: string) => string
}) {
  return (
    <Select value={selectValue(value)} onValueChange={(next) => onValueChange(selectedValue(next))}>
      <SelectTrigger className={cn('h-9 min-w-[132px] rounded-md bg-background', className)}>
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
  )
}

export function OrderFilters({
  state,
  searchValue,
  loadedCount,
  totalCount,
  onSearchChange,
  onChange,
  onReset,
}: OrderFiltersProps) {
  const hasFilters = !isDefault(state) || searchValue.trim() !== state.orderSearch

  return (
    <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
      <div className='relative min-w-[220px] flex-1'>
        <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground' />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder='Search orders'
          className='h-9 rounded-md bg-background pl-9'
        />
      </div>

      <FilterSelect
        value={state.provider}
        onValueChange={(provider) =>
          onChange({ provider: provider as OrdersFilterState['provider'] })
        }
        placeholder='All providers'
        options={ORDER_PROVIDER_FILTER_VALUES}
        labelFor={titleCase}
      />
      <FilterSelect
        value={state.submissionSource}
        onValueChange={(submissionSource) =>
          onChange({ submissionSource: submissionSource as OrdersFilterState['submissionSource'] })
        }
        placeholder='All sources'
        options={ORDER_SUBMISSION_SOURCE_FILTER_VALUES}
        labelFor={titleCase}
      />
      <FilterSelect
        value={state.status}
        onValueChange={(status) => onChange({ status: status as OrdersFilterState['status'] })}
        placeholder='All statuses'
        options={ORDER_STATUS_FILTER_VALUES}
        labelFor={titleCase}
      />
      <FilterSelect
        value={state.side}
        onValueChange={(side) => onChange({ side: side as OrdersFilterState['side'] })}
        placeholder='All sides'
        options={ORDER_SIDE_FILTER_VALUES}
        labelFor={titleCase}
        className='min-w-[112px]'
      />
      <FilterSelect
        value={state.orderType}
        onValueChange={(orderType) =>
          onChange({ orderType: orderType as OrdersFilterState['orderType'] })
        }
        placeholder='All order types'
        options={ORDER_TYPE_FILTER_VALUES}
        labelFor={titleCase}
        className='min-w-[150px]'
      />
      <FilterSelect
        value={state.timeInForce}
        onValueChange={(timeInForce) =>
          onChange({ timeInForce: timeInForce as OrdersFilterState['timeInForce'] })
        }
        placeholder='All TIF'
        options={ORDER_TIME_IN_FORCE_FILTER_VALUES}
        labelFor={uppercase}
        className='min-w-[112px]'
      />
      <FilterSelect
        value={state.linkedLog}
        onValueChange={(linkedLog) =>
          onChange({ linkedLog: linkedLog as OrdersFilterState['linkedLog'] })
        }
        placeholder='Any log link'
        options={ORDER_LINKED_LOG_FILTER_VALUES}
        labelFor={(value) => (value === 'true' ? 'Linked' : 'Unlinked')}
      />
      <FilterSelect
        value={state.environment}
        onValueChange={(environment) =>
          onChange({ environment: environment as OrdersFilterState['environment'] })
        }
        placeholder='All environments'
        options={ORDER_ENVIRONMENT_FILTER_VALUES}
        labelFor={titleCase}
        className='min-w-[150px]'
      />

      <FilterSelect
        value={state.orderSortBy}
        onValueChange={(orderSortBy) =>
          onChange({ orderSortBy: orderSortBy as OrdersFilterState['orderSortBy'] })
        }
        placeholder='Sort field'
        options={ORDER_SORT_BY_VALUES}
        labelFor={titleCase}
        className='min-w-[150px]'
      />
      <FilterSelect
        value={state.orderSortOrder}
        onValueChange={(orderSortOrder) =>
          onChange({ orderSortOrder: orderSortOrder as OrdersFilterState['orderSortOrder'] })
        }
        placeholder='Sort'
        options={ORDER_SORT_ORDER_VALUES}
        labelFor={uppercase}
        className='min-w-[92px]'
      />

      <Input
        type='datetime-local'
        aria-label='From'
        value={datetimeLocalValue(state.startDate)}
        onChange={(event) => onChange({ startDate: fromDatetimeLocal(event.target.value) })}
        className='h-9 w-[185px] rounded-md bg-background'
      />
      <Input
        type='datetime-local'
        aria-label='To'
        value={datetimeLocalValue(state.endDate)}
        onChange={(event) => onChange({ endDate: fromDatetimeLocal(event.target.value) })}
        className='h-9 w-[185px] rounded-md bg-background'
      />

      {hasFilters ? (
        <Button variant='ghost' size='sm' className='h-9 gap-2' onClick={onReset}>
          <X className='h-4 w-4' />
          Clear
        </Button>
      ) : null}

      <div className='ml-auto whitespace-nowrap text-muted-foreground text-xs'>
        Showing {loadedCount} of {totalCount}
      </div>
    </div>
  )
}
