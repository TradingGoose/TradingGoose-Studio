import type { RecordsOrder } from '@/hooks/queries/records-orders'

export const titleCase = (value: string | null | undefined) =>
  value
    ? value
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    : '—'

export const uppercase = (value: string | null | undefined) => (value ? value.toUpperCase() : '—')

export function formatDateTime(value: string | null | undefined, locale?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatCompactDateTime(value: string | null | undefined, locale?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 8,
  }).format(numeric)
}

export function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(numeric) >= 1 ? 2 : 6,
  }).format(numeric)
}

export function getExecutionPrice(
  order: RecordsOrder,
  labels?: {
    executionPrice: string
    submittedLimit: string
  }
) {
  const resolvedLabels = labels ?? {
    executionPrice: 'Execution price',
    submittedLimit: 'Submitted limit',
  }
  const executionPrice = order.fillPrice ?? order.averageFillPrice
  if (executionPrice !== null && executionPrice !== undefined && executionPrice !== '') {
    return {
      label: resolvedLabels.executionPrice,
      value: formatMoney(executionPrice),
    }
  }
  if (
    order.submittedPrice !== null &&
    order.submittedPrice !== undefined &&
    order.submittedPrice !== ''
  ) {
    return {
      label: resolvedLabels.submittedLimit,
      value: formatMoney(order.submittedPrice),
    }
  }
  return {
    label: resolvedLabels.executionPrice,
    value: '—',
  }
}

export function orderIdentifier(order: RecordsOrder) {
  return order.providerOrderId ?? order.id
}
