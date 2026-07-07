'use client'

import { useLocale } from 'next-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { formatLocalizedNumber, formatUsd } from '@/i18n/formatters'
import type { OrderHistorySearchOption } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/types'
import { useWorkflowBlockEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

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

const formatOrderDate = (locale: string, value?: string | null): string | null => {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: '2-digit',
  }).format(date)
}

const formatQuantity = (
  locale: string,
  quantity: number,
  copy: {
    quantitySingular: string
    quantityPlural: string
  }
): string => {
  const normalized = formatLocalizedNumber(locale, quantity, { maximumFractionDigits: 8 })
  const label = Math.abs(quantity) === 1 ? copy.quantitySingular : copy.quantityPlural
  return `${normalized} ${label}`
}

const formatNotional = (locale: string, amount: number): string => {
  return `${formatUsd(locale, amount, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} USD`
}

export const formatOrderAmountAndDate = (
  locale: string,
  order: OrderHistorySearchOption,
  copy: {
    quantitySingular: string
    quantityPlural: string
  }
): string => {
  const dateLabel = formatOrderDate(locale, order.placedAt || order.recordedAt)

  if (typeof order.quantity === 'number' && Number.isFinite(order.quantity)) {
    return dateLabel
      ? `${formatQuantity(locale, order.quantity, copy)}, ${dateLabel}`
      : formatQuantity(locale, order.quantity, copy)
  }

  if (typeof order.notional === 'number' && Number.isFinite(order.notional)) {
    return dateLabel
      ? `${formatNotional(locale, order.notional)}, ${dateLabel}`
      : formatNotional(locale, order.notional)
  }

  return dateLabel ?? '—'
}

export const formatOrderAction = (
  side: string | null | undefined,
  copy: { buy: string; sell: string }
): string => {
  const normalized = side?.trim().toLowerCase()
  if (normalized === 'buy') return copy.buy
  if (normalized === 'sell') return copy.sell
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
  placeholderTitle,
  placeholderSubtitle,
  className,
}: OrderIdRowProps) {
  const locale = useLocale()
  const copy = useWorkflowBlockEditorCopy().orderIdSelector
  const primary = order ? getOrderPrimary(order) : ''
  const quote = order?.quote?.trim() || ''
  const resolvedPlaceholderTitle = placeholderTitle || copy.placeholderTitle
  const resolvedPlaceholderSubtitle = placeholderSubtitle || copy.placeholderSubtitle
  const summary = order
    ? formatOrderAmountAndDate(locale, order, copy)
    : resolvedPlaceholderSubtitle
  const actionLabel = formatOrderAction(order?.side, copy)
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
            {resolvedPlaceholderTitle}
          </span>
        )}
        <span className='max-w-full truncate text-muted-foreground text-xs'>
          {order ? summary : resolvedPlaceholderSubtitle}
        </span>
      </div>
      {order ? (
        <span className='ml-auto font-semibold text-muted-foreground text-xs'>{actionLabel}</span>
      ) : null}
    </div>
  )
}
