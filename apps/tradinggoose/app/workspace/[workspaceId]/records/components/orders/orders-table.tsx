'use client'

import type React from 'react'
import { type RefObject, useMemo } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Info, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  getListingIdentityKey,
  type ListingIdentity,
  toListingValueObject,
} from '@/lib/listing/identity'
import type { OrdersFilterState } from '@/lib/records/order-filters'
import { cn } from '@/lib/utils'
import { useResolvedListings } from '@/hooks/queries/listing-resolution'
import type { RecordsOrder } from '@/hooks/queries/records-orders'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import {
  formatCompactDateTime,
  formatMoney,
  formatNumber,
  getExecutionPrice,
  getOrderListingFallback,
  titleCase,
  uppercase,
} from './order-formatters'
import { OrderRowActions } from './order-row-actions'
import { OrderStatusBadge } from './order-status-badge'

type OrdersTableProps = {
  orders: RecordsOrder[]
  selectedOrderId: string | null
  loading: boolean
  error: string | null
  hasMore: boolean
  isFetchingMore: boolean
  sortBy: OrdersFilterState['orderSortBy']
  sortOrder: OrdersFilterState['orderSortOrder']
  onSortChange: (sortBy: OrdersFilterState['orderSortBy']) => void
  onOrderClick: (order: RecordsOrder) => void
  loaderRef: RefObject<HTMLDivElement | null>
  scrollContainerRef: RefObject<HTMLDivElement | null>
  selectedRowRef: RefObject<HTMLTableRowElement | null>
}

const columns = [
  'w-[240px]',
  'w-[100px]',
  'w-[90px]',
  'w-[105px]',
  'w-[125px]',
  'w-[110px]',
  'w-[105px]',
  'w-[120px]',
  'w-[120px]',
  'w-[120px]',
  'w-[110px]',
]

const orderTableMinWidth = 'min-w-[1345px]'
const tableHeadClassName = 'px-4 pt-2 pb-3 text-center align-middle font-medium'
const tableCellClassName = 'px-4 py-3 text-center align-middle'

function HeadLabel({ children }: { children: React.ReactNode }) {
  return <span className='text-muted-foreground text-xs leading-none'>{children}</span>
}

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
      className={cn(tableHeadClassName, className)}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='h-auto gap-1 rounded-none bg-transparent px-0 py-0 font-medium text-muted-foreground text-xs leading-none hover:bg-transparent hover:text-foreground'
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

function collectListingIdentities(orders: RecordsOrder[]): ListingIdentity[] {
  const seen = new Set<string>()
  const listings: ListingIdentity[] = []

  for (const order of orders) {
    const listing = toListingValueObject(order.listingIdentity)
    if (!listing) continue
    const key = getListingIdentityKey(listing)
    if (seen.has(key)) continue
    seen.add(key)
    listings.push(listing)
  }

  return listings
}

export function OrdersTable({
  orders,
  selectedOrderId,
  loading,
  error,
  hasMore,
  isFetchingMore,
  sortBy,
  sortOrder,
  onSortChange,
  onOrderClick,
  loaderRef,
  scrollContainerRef,
  selectedRowRef,
}: OrdersTableProps) {
  const locale = useLocale()
  const t = useTranslations('workspace.records.orders')
  const listingIdentities = useMemo(() => collectListingIdentities(orders), [orders])
  const resolvedListingsQuery = useResolvedListings({
    listings: listingIdentities,
    enabled: listingIdentities.length > 0 && !loading && !error,
  })

  return (
    <div className='flex h-full max-h-full min-h-0 min-w-0 flex-1 overflow-hidden'>
      <div className='flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden'>
        <div className='flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden p-1'>
          <div className='flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border'>
            <div className='h-full max-h-full min-h-0 w-full overflow-x-auto overflow-y-hidden'>
              <div
                className={cn(
                  'flex h-full max-h-full min-h-0 w-full min-w-0 flex-col',
                  orderTableMinWidth
                )}
              >
                <div className='shrink-0 border-b bg-card/40'>
                  <table className='w-full table-fixed caption-bottom text-sm'>
                    <ColGroup />
                    <TableHeader>
                      <TableRow>
                        <SortHead
                          field='listing'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('listing')}
                        </SortHead>
                        <TableHead className={tableHeadClassName}>
                          <HeadLabel>{t('submissionSource')}</HeadLabel>
                        </TableHead>
                        <SortHead
                          field='side'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('side')}
                        </SortHead>
                        <SortHead
                          field='orderType'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('orderType')}
                        </SortHead>
                        <SortHead
                          field='quantity'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('quantity')}
                        </SortHead>
                        <SortHead
                          field='averageFillPrice'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('executionPrice')}
                        </SortHead>
                        <SortHead
                          field='provider'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('provider')}
                        </SortHead>
                        <SortHead
                          field='status'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('status')}
                        </SortHead>
                        <SortHead
                          field='recordedAt'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('recordedAt')}
                        </SortHead>
                        <SortHead
                          field='updatedAt'
                          current={sortBy}
                          order={sortOrder}
                          onSortChange={onSortChange}
                        >
                          {t('updatedAt')}
                        </SortHead>
                        <TableHead className={cn(tableHeadClassName, 'text-right')}>
                          <HeadLabel>{t('actions')}</HeadLabel>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                  </table>
                </div>

                <div
                  ref={scrollContainerRef}
                  className='h-full max-h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden'
                  style={{ scrollbarGutter: 'stable' }}
                >
                  {loading ? (
                    <div className='flex h-full items-center justify-center p-5'>
                      <div className='flex items-center gap-2 text-muted-foreground'>
                        <Loader2 className='h-5 w-5 animate-spin' />
                        <span className='text-sm'>{t('loading')}</span>
                      </div>
                    </div>
                  ) : error ? (
                    <div className='flex h-full items-center justify-center'>
                      <div className='flex items-center gap-2 text-destructive'>
                        <AlertCircle className='h-5 w-5' />
                        <span className='text-sm'>Error: {error}</span>
                      </div>
                    </div>
                  ) : orders.length === 0 ? (
                    <div className='flex h-full items-center justify-center'>
                      <div className='flex items-center gap-2 text-muted-foreground'>
                        <Info className='h-5 w-5' />
                        <span className='text-sm'>{t('emptyState')}</span>
                      </div>
                    </div>
                  ) : (
                    <table className='w-full table-fixed caption-bottom text-sm'>
                      <ColGroup />
                      <TableBody>
                        {orders.map((order) => {
                          const isSelected = selectedOrderId === order.id
                          const executionPrice = getExecutionPrice(order, {
                            executionPrice: t('executionPrice'),
                            submittedLimit: t('submittedLimit'),
                          })
                          const listingIdentity = toListingValueObject(order.listingIdentity)
                          const resolvedListing = listingIdentity
                            ? (resolvedListingsQuery.data?.[
                                getListingIdentityKey(listingIdentity)
                              ] ?? null)
                            : null
                          const displayListing = resolvedListing ?? getOrderListingFallback(order)
                          const providerOrderDetailUrl =
                            getTradingProviderDefinition(order.provider)?.orderDetailSiteUrl?.({
                              environment: order.environment,
                              providerOrderId: order.providerOrderId,
                            }) ?? null
                          return (
                            <TableRow
                              key={order.id}
                              ref={isSelected ? selectedRowRef : null}
                              className={cn(
                                'cursor-pointer border-b transition-colors hover:bg-card/30',
                                isSelected && 'selected-row bg-accent'
                              )}
                              onClick={() => onOrderClick(order)}
                            >
                              <TableCell className={cn(tableCellClassName, 'text-left')}>
                                {displayListing ? (
                                  <MarketListingRow
                                    listing={{ ...displayListing, countryCode: null }}
                                    className='w-full min-w-0 justify-start pr-0 text-left'
                                  />
                                ) : (
                                  <span className='block truncate text-muted-foreground text-sm'>
                                    {listingIdentity ? 'Resolving listing' : t('unknownListing')}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className={tableCellClassName}>
                                <Badge variant='secondary'>
                                  {titleCase(order.submissionSource)}
                                </Badge>
                              </TableCell>
                              <TableCell className={tableCellClassName}>
                                {titleCase(order.side)}
                              </TableCell>
                              <TableCell className={tableCellClassName}>
                                <div className='text-[13px]'>{titleCase(order.orderType)}</div>
                                <div className='text-muted-foreground text-xs'>
                                  {uppercase(order.timeInForce)}
                                </div>
                              </TableCell>
                              <TableCell className={tableCellClassName}>
                                <div className='font-medium text-[13px]'>
                                  {formatNumber(order.quantity)}
                                </div>
                                <div className='text-muted-foreground text-xs'>
                                  {t('filled')} {formatNumber(order.filledQuantity)}
                                </div>
                                <div className='text-muted-foreground text-xs'>
                                  {t('remaining')} {formatNumber(order.remainingQuantity)}
                                </div>
                              </TableCell>
                              <TableCell className={tableCellClassName}>
                                <div className='font-medium text-[13px]'>
                                  {executionPrice.value}
                                </div>
                                <div className='text-muted-foreground text-xs'>
                                  {executionPrice.label}
                                </div>
                                <div className='text-muted-foreground text-xs'>
                                  {t('fee')} {formatMoney(order.fee)}
                                </div>
                              </TableCell>
                              <TableCell className={tableCellClassName}>
                                <Badge variant='outline'>{titleCase(order.provider)}</Badge>
                              </TableCell>
                              <TableCell className={tableCellClassName}>
                                <OrderStatusBadge status={order.status} />
                                {order.message ? (
                                  <div className='mt-1 truncate text-muted-foreground text-xs'>
                                    {order.message}
                                  </div>
                                ) : null}
                              </TableCell>
                              <TableCell
                                className={cn(tableCellClassName, 'text-muted-foreground text-xs')}
                              >
                                {formatCompactDateTime(order.recordedAt, locale)}
                              </TableCell>
                              <TableCell
                                className={cn(tableCellClassName, 'text-muted-foreground text-xs')}
                              >
                                {formatCompactDateTime(order.updatedAt, locale)}
                              </TableCell>
                              <TableCell className={cn(tableCellClassName, 'text-right')}>
                                <OrderRowActions
                                  order={order}
                                  providerOrderDetailUrl={providerOrderDetailUrl}
                                />
                              </TableCell>
                            </TableRow>
                          )
                        })}

                        {hasMore && (
                          <TableRow>
                            <TableCell colSpan={11} className='px-4 py-4 text-center align-middle'>
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
                        )}
                      </TableBody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
