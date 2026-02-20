'use client'

import { format } from 'date-fns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { OrderHistorySearchOption } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/types'

const SHARE_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 8,
})

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export const getOrderEnvironmentEmoji = (environment?: string | null): string => {
  const normalized = environment?.trim().toLowerCase()
  if (normalized === 'paper' || normalized === 'paper_trading' || normalized === 'paper trading') {
    return '📝'
  }
  if (normalized === 'live' || normalized === 'live_trading' || normalized === 'live trading') {
    return '💵'
  }
  return '•'
}

export const getOrderPrimary = (order: OrderHistorySearchOption): string => {
  return order.symbol?.trim() || order.companyName?.trim() || order.id
}

export const getOrderFallback = (order: OrderHistorySearchOption): string => {
  const primary = getOrderPrimary(order)
  return primary.slice(0, 2).toUpperCase()
}

const formatOrderDate = (value?: string | null): string | null => {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return format(date, 'MMM dd')
}

const formatQuantity = (quantity: number): string => {
  const normalized = SHARE_FORMATTER.format(quantity)
  const label = Math.abs(quantity) === 1 ? 'Share' : 'Shares'
  return `${normalized} ${label}`
}

const formatNotional = (amount: number): string => {
  return `$${USD_FORMATTER.format(amount)} USD`
}

export const formatOrderAmountAndDate = (order: OrderHistorySearchOption): string => {
  const dateLabel = formatOrderDate(order.placedAt || order.recordedAt)

  if (typeof order.quantity === 'number' && Number.isFinite(order.quantity)) {
    return dateLabel
      ? `${formatQuantity(order.quantity)}, ${dateLabel}`
      : formatQuantity(order.quantity)
  }

  if (typeof order.notional === 'number' && Number.isFinite(order.notional)) {
    return dateLabel
      ? `${formatNotional(order.notional)}, ${dateLabel}`
      : formatNotional(order.notional)
  }

  return dateLabel ?? '—'
}

export const formatOrderAction = (side?: string | null): string => {
  const normalized = side?.trim().toLowerCase()
  if (normalized === 'buy') return 'Buy'
  if (normalized === 'sell') return 'Sell'
  return '—'
}

export interface OrderIdRowProps {
  order?: OrderHistorySearchOption | null
  placeholderTitle?: string
  placeholderSubtitle?: string
  className?: string
}

export function OrderIdRow({
  order,
  placeholderTitle = 'Select order',
  placeholderSubtitle = 'Search by order ID, symbol, or date',
  className,
}: OrderIdRowProps) {
  const primary = order ? getOrderPrimary(order) : ''
  const quote = order?.quote?.trim() || ''
  const summary = order ? formatOrderAmountAndDate(order) : placeholderSubtitle
  const actionLabel = formatOrderAction(order?.side)
  const environmentEmoji = getOrderEnvironmentEmoji(order?.environment)

  return (
    <div className={cn('flex items-center gap-2 pr-2', className)}>
      <Avatar className='m-1 h-6 w-6 rounded-sm bg-secondary/60 text-foreground'>
        {order?.iconUrl ? <AvatarImage src={order.iconUrl} alt={primary} /> : null}
        <AvatarFallback className='text-accent-foreground text-xs'>
          {order ? getOrderFallback(order) : '??'}
        </AvatarFallback>
      </Avatar>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5 text-start leading-none'>
        {order ? (
          <span className='flex items-center gap-1 font-semibold text-sm'>
            <span className='max-w-[22ch] truncate'>
              {primary}
              {quote ? <span className='text-muted-foreground'>/{quote}</span> : null}
            </span>
            <span className='ml-1 text-xs'>{environmentEmoji}</span>
          </span>
        ) : (
          <span className='max-w-full truncate font-semibold text-muted-foreground text-sm'>
            {placeholderTitle}
          </span>
        )}
        <span className='max-w-full truncate text-muted-foreground text-xs'>{summary}</span>
      </div>
      {order ? (
        <span className='ml-auto font-semibold text-muted-foreground text-xs'>{actionLabel}</span>
      ) : null}
    </div>
  )
}
