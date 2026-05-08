'use client'

import type React from 'react'
import type { RefObject } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Info, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { OrdersFilterState } from '@/lib/records/order-filters'
import { cn } from '@/lib/utils'
import type { RecordsOrder } from '@/hooks/queries/records-orders'
import {
  formatCompactDateTime,
  formatMoney,
  formatNumber,
  getExecutionPrice,
  titleCase,
  uppercase,
} from './order-formatters'
import { OrderRowActions } from './order-row-actions'
import { OrderStatusBadge } from './order-status-badge'

type OrdersTableProps = {
  orders: RecordsOrder[]
  total: number
  selectedOrderId: string | null
  loading: boolean
  error: string | null
  hasMore: boolean
  isFetchingMore: boolean
  sortBy: OrdersFilterState['orderSortBy']
  sortOrder: OrdersFilterState['orderSortOrder']
  onSortChange: (sortBy: OrdersFilterState['orderSortBy']) => void
  onOrderClick: (order: RecordsOrder) => void
  onOpenOrder: (order: RecordsOrder) => void
  onOpenLog: (order: RecordsOrder) => void
  onOpenProvider: (order: RecordsOrder) => void
  loaderRef: RefObject<HTMLDivElement | null>
  scrollContainerRef: RefObject<HTMLDivElement | null>
  selectedRowRef: RefObject<HTMLTableRowElement | null>
}

const columns = [
  'min-w-[150px]',
  'min-w-[110px]',
  'min-w-[170px]',
  'min-w-[110px]',
  'min-w-[115px]',
  'min-w-[130px]',
  'min-w-[115px]',
  'min-w-[120px]',
  'min-w-[125px]',
  'min-w-[120px]',
  'min-w-[100px]',
  'min-w-[130px]',
]

function SortHead({
  field,
  current,
  order,
  children,
  onSortChange,
  className,
}: {
  field: OrdersFilterState['orderSortBy']
  current: OrdersFilterState['orderSortBy']
  order: OrdersFilterState['orderSortOrder']
  children: React.ReactNode
  onSortChange: (field: OrdersFilterState['orderSortBy']) => void
  className?: string
}) {
  const active = field === current
  return (
    <TableHead
      className={cn('px-3 py-2 text-center align-middle text-xs', className)}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='h-7 gap-1 px-2 text-xs'
        onClick={() => onSortChange(field)}
      >
        {children}
        {active ? (
          order === 'asc' ? (
            <ArrowUp className='h-3.5 w-3.5' />
          ) : (
            <ArrowDown className='h-3.5 w-3.5' />
          )
        ) : null}
      </Button>
    </TableHead>
  )
}

function ColGroup() {
  return (
    <colgroup>
      {columns.map((className, index) => (
        <col key={index} className={className} />
      ))}
    </colgroup>
  )
}

export function OrdersTable({
  orders,
  total,
  selectedOrderId,
  loading,
  error,
  hasMore,
  isFetchingMore,
  sortBy,
  sortOrder,
  onSortChange,
  onOrderClick,
  onOpenOrder,
  onOpenLog,
  onOpenProvider,
  loaderRef,
  scrollContainerRef,
  selectedRowRef,
}: OrdersTableProps) {
  return (
    <div className='flex h-full max-h-full min-h-0 min-w-0 flex-1 overflow-hidden p-1'>
      <div className='flex h-full max-h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border'>
        <div className='shrink-0 border-b bg-card/40'>
          <Table className='w-full table-auto'>
            <ColGroup />
            <TableHeader>
              <TableRow>
                <SortHead
                  field='listing'
                  current={sortBy}
                  order={sortOrder}
                  onSortChange={onSortChange}
                >
                  Listing
                </SortHead>
                <TableHead className='px-3 py-2 text-center text-xs'>Source</TableHead>
                <TableHead className='px-3 py-2 text-center text-xs'>Order IDs</TableHead>
                <SortHead
                  field='side'
                  current={sortBy}
                  order={sortOrder}
                  onSortChange={onSortChange}
                >
                  Side
                </SortHead>
                <SortHead
                  field='orderType'
                  current={sortBy}
                  order={sortOrder}
                  onSortChange={onSortChange}
                >
                  Type
                </SortHead>
                <SortHead
                  field='quantity'
                  current={sortBy}
                  order={sortOrder}
                  onSortChange={onSortChange}
                >
                  Quantity
                </SortHead>
                <SortHead
                  field='averageFillPrice'
                  current={sortBy}
                  order={sortOrder}
                  onSortChange={onSortChange}
                >
                  Price
                </SortHead>
                <SortHead
                  field='provider'
                  current={sortBy}
                  order={sortOrder}
                  onSortChange={onSortChange}
                >
                  Provider
                </SortHead>
                <SortHead
                  field='status'
                  current={sortBy}
                  order={sortOrder}
                  onSortChange={onSortChange}
                >
                  Status
                </SortHead>
                <SortHead
                  field='submittedAt'
                  current={sortBy}
                  order={sortOrder}
                  onSortChange={onSortChange}
                >
                  Time
                </SortHead>
                <TableHead className='px-3 py-2 text-center text-xs'>Log</TableHead>
                <TableHead className='px-3 py-2 text-right text-xs'>Actions</TableHead>
              </TableRow>
            </TableHeader>
          </Table>
        </div>

        <div
          ref={scrollContainerRef}
          className='h-full max-h-full min-h-0 flex-1 overflow-auto'
          style={{ scrollbarGutter: 'stable' }}
        >
          {loading ? (
            <div className='flex h-full items-center justify-center gap-2 text-muted-foreground'>
              <Loader2 className='h-5 w-5 animate-spin' />
              <span className='text-sm'>Loading orders...</span>
            </div>
          ) : error ? (
            <div className='flex h-full items-center justify-center gap-2 text-destructive'>
              <AlertCircle className='h-5 w-5' />
              <span className='text-sm'>{error}</span>
            </div>
          ) : orders.length === 0 ? (
            <div className='flex h-full items-center justify-center gap-2 text-muted-foreground'>
              <Info className='h-5 w-5' />
              <span className='text-sm'>No orders found</span>
            </div>
          ) : (
            <Table className='w-full table-auto'>
              <ColGroup />
              <TableBody>
                {orders.map((order) => {
                  const isSelected = selectedOrderId === order.id
                  const executionPrice = getExecutionPrice(order)
                  return (
                    <TableRow
                      key={order.id}
                      ref={isSelected ? selectedRowRef : null}
                      className={cn(
                        'cursor-pointer hover:bg-card/30',
                        isSelected && 'selected-row bg-accent'
                      )}
                      onClick={() => onOrderClick(order)}
                    >
                      <TableCell className='px-3 py-3 text-center'>
                        <div className='truncate font-medium text-[13px]'>
                          {order.listing.symbol ?? 'Unknown'}
                        </div>
                        <div className='truncate text-muted-foreground text-xs'>
                          {order.listing.name ?? order.listing.listingType ?? '—'}
                        </div>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        <Badge variant='secondary'>{titleCase(order.submissionSource)}</Badge>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        <div className='truncate font-mono text-xs'>{order.id}</div>
                        <div className='truncate text-muted-foreground text-xs'>
                          {order.providerOrderId ?? 'No provider id'}
                        </div>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        {titleCase(order.side)}
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        <div className='text-[13px]'>{titleCase(order.orderType)}</div>
                        <div className='text-muted-foreground text-xs'>
                          {uppercase(order.timeInForce)}
                        </div>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        <div className='font-medium text-[13px]'>
                          {formatNumber(order.quantity)}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          Filled {formatNumber(order.filledQuantity)}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          Rem {formatNumber(order.remainingQuantity)}
                        </div>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        <div className='font-medium text-[13px]'>{executionPrice.value}</div>
                        <div className='text-muted-foreground text-xs'>{executionPrice.label}</div>
                        <div className='text-muted-foreground text-xs'>
                          Fee {formatMoney(order.fee)}
                        </div>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        <Badge variant='outline'>{titleCase(order.provider)}</Badge>
                        <div className='truncate text-muted-foreground text-xs'>
                          {order.accountId ?? 'No account'}
                        </div>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        <OrderStatusBadge status={order.status} />
                        {order.message ? (
                          <div className='mt-1 truncate text-muted-foreground text-xs'>
                            {order.message}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center text-muted-foreground text-xs'>
                        <div>{formatCompactDateTime(order.submittedAt ?? order.recordedAt)}</div>
                        <div>Recorded {formatCompactDateTime(order.recordedAt)}</div>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-center'>
                        <Badge variant={order.logId ? 'default' : 'outline'}>
                          {order.logId ? 'Linked' : 'Unlinked'}
                        </Badge>
                      </TableCell>
                      <TableCell className='px-3 py-3 text-right'>
                        <OrderRowActions
                          order={order}
                          onOpenOrder={onOpenOrder}
                          onOpenLog={onOpenLog}
                          onOpenProvider={onOpenProvider}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}

                {hasMore ? (
                  <TableRow>
                    <TableCell colSpan={12} className='px-4 py-4 text-center'>
                      <div
                        ref={loaderRef}
                        className='flex items-center justify-center gap-2 text-muted-foreground'
                      >
                        {isFetchingMore ? (
                          <>
                            <Loader2 className='h-4 w-4 animate-spin' />
                            <span className='text-sm'>Loading more...</span>
                          </>
                        ) : (
                          <span className='text-sm'>Scroll to load more</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={12}
                      className='px-4 py-3 text-center text-muted-foreground text-xs'
                    >
                      Showing {orders.length} of {total}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}
