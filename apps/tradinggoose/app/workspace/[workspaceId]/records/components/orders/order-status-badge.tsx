'use client'

import { Badge } from '@/components/ui/badge'
import { titleCase } from './order-formatters'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  filled: 'default',
  partially_filled: 'secondary',
  submitted: 'secondary',
  new: 'secondary',
  canceled: 'outline',
  expired: 'outline',
  rejected: 'destructive',
  invalid: 'destructive',
}

export function OrderStatusBadge({ status }: { status: string | null | undefined }) {
  return (
    <Badge
      variant={status ? (STATUS_VARIANT[status] ?? 'secondary') : 'outline'}
      className='shrink-0'
    >
      {titleCase(status)}
    </Badge>
  )
}
