'use client'

import type React from 'react'
import { useMemo } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, Loader2, RefreshCw, X } from 'lucide-react'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getListingIdentityKey, toListingValueObject } from '@/lib/listing/identity'
import { LogDetails } from '@/app/workspace/[workspaceId]/records/components/log-details/log-details'
import { useResolvedListings } from '@/hooks/queries/listing-resolution'
import { useProviderOrderDetail } from '@/hooks/queries/records-orders'
import { getTradingProviderOAuthServiceIds } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { formatDateTime, formatMoney, formatNumber, titleCase, uppercase } from './order-formatters'
import { OrderStatusBadge } from './order-status-badge'
import type { RecordsOrder, RecordsOrderDetailMode } from './types'

type OrderDetailsProps = {
  workspaceId: string
  order: RecordsOrder
  detail: RecordsOrder | null
  detailsLoading: boolean
  detailsError: string | null
  linkedLog: WorkflowLog | null
  linkedLogLoading: boolean
  linkedLogError: string | null
  mode: RecordsOrderDetailMode
  onModeChange: (mode: RecordsOrderDetailMode) => void
  onClose: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
  onRetryDetails: () => void
  onRetryLog: () => void
}

const hasValue = (value: unknown) => value !== null && value !== undefined && value !== ''

const DetailSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className='overflow-hidden rounded-md border bg-muted/30'>
    <div className='border-b px-3 py-2'>
      <h3 className='font-medium text-muted-foreground text-xs'>{title}</h3>
    </div>
    <div className='divide-y'>{children}</div>
  </section>
)

const DetailRow = ({
  label,
  value,
  copyValue,
}: {
  label: string
  value: React.ReactNode
  copyValue?: string | null
}) => (
  <div className='group relative flex min-h-10 items-start justify-between gap-3 px-3 py-2'>
    <div className='w-[132px] shrink-0 pt-0.5 font-medium text-muted-foreground text-xs'>
      {label}
    </div>
    <div className='min-w-0 break-words text-foreground text-sm'>
      {hasValue(value) ? value : '—'}
    </div>
    {copyValue ? <CopyButton text={copyValue} className='h-5 w-5' showLabel={false} /> : null}
  </div>
)

const CopyableCode = ({ value }: { value: string | null | undefined }) =>
  value ? <code className='block truncate font-mono text-xs'>{value}</code> : '—'

type ProviderDetailResponse = {
  data?: {
    orderDetail?: Record<string, any>
  }
}

const changedProviderRows = (order: RecordsOrder, providerDetail: Record<string, any> | null) => {
  if (!providerDetail) return []
  const savedExecutionPrice = order.fillPrice ?? order.averageFillPrice
  const rows = [
    ['Status', titleCase(order.status), titleCase(providerDetail.status)],
    [
      'Filled quantity',
      formatNumber(order.filledQuantity),
      formatNumber(providerDetail.filledQuantity),
    ],
    [
      'Remaining quantity',
      formatNumber(order.remainingQuantity),
      formatNumber(providerDetail.remainingQuantity),
    ],
    [
      'Execution price',
      formatMoney(savedExecutionPrice),
      formatMoney(providerDetail.averageFillPrice),
    ],
    ['Updated at', formatDateTime(order.updatedAt), formatDateTime(providerDetail.updatedAt)],
    ['Filled at', formatDateTime(order.filledAt), formatDateTime(providerDetail.filledAt)],
  ] as const

  return rows.filter(([, saved, latest]) => latest !== '—' && latest !== saved)
}

function useResolvedOrderListing(listingIdentityValue: unknown) {
  const listingIdentity = useMemo(
    () => toListingValueObject(listingIdentityValue),
    [listingIdentityValue]
  )
  const listings = useMemo(() => (listingIdentity ? [listingIdentity] : []), [listingIdentity])
  const resolvedListingsQuery = useResolvedListings({
    listings,
    enabled: Boolean(listingIdentity),
  })
  const listing = listingIdentity
    ? (resolvedListingsQuery.data?.[getListingIdentityKey(listingIdentity)] ?? null)
    : null

  return { listing, listingIdentity }
}

function ResolvedOrderListing({
  listingIdentityValue,
  compact = false,
  showAssetClass = false,
  className,
}: {
  listingIdentityValue: unknown
  compact?: boolean
  showAssetClass?: boolean
  className?: string
}) {
  const { listing, listingIdentity } = useResolvedOrderListing(listingIdentityValue)

  return (
    <MarketListingRow
      listing={listing}
      compact={compact}
      showAssetClass={showAssetClass}
      className={className}
      placeholderTitle={listingIdentity ? 'Resolving listing' : 'Unknown listing'}
      placeholderSubtitle={listingIdentity ? 'Loading listing metadata' : 'No listing identity'}
    />
  )
}

function OrderData({
  order,
  detail,
  loading,
  error,
  onRetry,
  providerDetail,
  providerDetailError,
}: {
  order: RecordsOrder
  detail: RecordsOrder | null
  loading: boolean
  error: string | null
  onRetry: () => void
  providerDetail: ProviderDetailResponse | undefined
  providerDetailError: unknown
}) {
  const active = detail ?? order
  const executionPrice = active.fillPrice ?? active.averageFillPrice
  const latestProviderDetail =
    (providerDetail?.data?.orderDetail as Record<string, any> | undefined) ?? null
  const providerRows = changedProviderRows(active, latestProviderDetail)
  const showWorkflow =
    Boolean(active.logId) ||
    Boolean(active.linkedLog?.executionId) ||
    Boolean(active.linkedLog?.workflowName)
  const optionalTimelineRows = [
    ['Filled at', active.filledAt],
    ['Canceled at', active.canceledAt],
    ['Expired at', active.expiredAt],
  ] as const

  return (
    <ScrollArea className='h-full w-full min-w-0 max-w-full overflow-y-auto'>
      <div className='flex w-full min-w-0 max-w-full flex-col gap-3 px-3 pt-4 pb-4'>
        {loading ? (
          <div className='flex items-center gap-2 text-muted-foreground text-sm'>
            <Loader2 className='h-4 w-4 animate-spin' />
            Loading full order record...
          </div>
        ) : error ? (
          <div className='flex items-center justify-between gap-3 rounded-md border border-destructive/30 p-3 text-destructive text-sm'>
            <span>{error}</span>
            <Button variant='outline' size='sm' onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : null}

        <section className='overflow-hidden rounded-md border bg-muted/30 p-3'>
          <div className='flex min-w-0 flex-col gap-2'>
            <ResolvedOrderListing
              listingIdentityValue={active.listingIdentity}
              showAssetClass
              className='w-full min-w-0 pr-0'
            />
            <div className='flex flex-wrap items-center gap-2'>
              <OrderStatusBadge status={active.status} />
              <Badge variant='secondary'>{titleCase(active.submissionSource)}</Badge>
            </div>
          </div>
          {active.message ? (
            <p className='mt-3 border-t pt-3 text-muted-foreground text-sm'>{active.message}</p>
          ) : null}
        </section>

        <DetailSection title='Execution'>
          <DetailRow label='Side' value={titleCase(active.side)} />
          <DetailRow label='Order type' value={titleCase(active.orderType)} />
          <DetailRow label='Time in force' value={uppercase(active.timeInForce)} />
          <DetailRow label='Quantity' value={formatNumber(active.quantity)} />
          <DetailRow label='Filled quantity' value={formatNumber(active.filledQuantity)} />
          {hasValue(active.remainingQuantity) ? (
            <DetailRow label='Remaining quantity' value={formatNumber(active.remainingQuantity)} />
          ) : null}
          {hasValue(active.notional) ? (
            <DetailRow label='Notional' value={formatMoney(active.notional)} />
          ) : null}
          {hasValue(active.submittedPrice) ? (
            <DetailRow label='Submitted price' value={formatMoney(active.submittedPrice)} />
          ) : null}
          <DetailRow label='Execution price' value={formatMoney(executionPrice)} />
          <DetailRow label='Fee' value={formatMoney(active.fee)} />
        </DetailSection>

        <DetailSection title='Provider'>
          <DetailRow label='Provider' value={titleCase(active.provider)} />
          <DetailRow label='Environment' value={titleCase(active.environment)} />
          {hasValue(active.providerOrderId) ? (
            <DetailRow
              label='Provider order id'
              value={<CopyableCode value={active.providerOrderId} />}
              copyValue={active.providerOrderId}
            />
          ) : null}
          {providerDetailError ? (
            <DetailRow
              label='Latest check'
              value={
                <span className='text-destructive'>
                  {providerDetailError instanceof Error
                    ? providerDetailError.message
                    : 'Provider detail check failed.'}
                </span>
              }
            />
          ) : latestProviderDetail ? (
            providerRows.length > 0 ? (
              providerRows.map(([label, saved, latest]) => (
                <DetailRow
                  key={label}
                  label={label}
                  value={
                    <span className='flex min-w-0 flex-wrap items-center gap-2'>
                      <span className='text-muted-foreground'>{saved}</span>
                      <span className='text-muted-foreground text-xs'>latest</span>
                      <span className='font-medium'>{latest}</span>
                    </span>
                  }
                />
              ))
            ) : (
              <DetailRow label='Latest check' value='Provider detail matches saved record.' />
            )
          ) : null}
        </DetailSection>

        <DetailSection title='Timeline'>
          <DetailRow label='Recorded at' value={formatDateTime(active.recordedAt)} />
          {hasValue(active.submittedAt) ? (
            <DetailRow label='Submitted at' value={formatDateTime(active.submittedAt)} />
          ) : null}
          {hasValue(active.updatedAt) ? (
            <DetailRow label='Updated at' value={formatDateTime(active.updatedAt)} />
          ) : null}
          {optionalTimelineRows.map(([label, value]) =>
            value ? <DetailRow key={label} label={label} value={formatDateTime(value)} /> : null
          )}
        </DetailSection>

        {showWorkflow ? (
          <DetailSection title='Workflow'>
            {hasValue(active.linkedLog?.workflowName) ? (
              <DetailRow label='Workflow name' value={active.linkedLog?.workflowName} />
            ) : null}
            {hasValue(active.logId) ? (
              <DetailRow
                label='Log id'
                value={<CopyableCode value={active.logId} />}
                copyValue={active.logId}
              />
            ) : null}
            {hasValue(active.linkedLog?.executionId) ? (
              <DetailRow
                label='Execution id'
                value={<CopyableCode value={active.linkedLog?.executionId} />}
                copyValue={active.linkedLog?.executionId}
              />
            ) : null}
            {hasValue(active.linkedLog?.level) ? (
              <DetailRow label='Level' value={titleCase(active.linkedLog?.level)} />
            ) : null}
            {hasValue(active.linkedLog?.startedAt) ? (
              <DetailRow label='Started at' value={formatDateTime(active.linkedLog?.startedAt)} />
            ) : null}
            {hasValue(active.linkedLog?.endedAt) ? (
              <DetailRow label='Ended at' value={formatDateTime(active.linkedLog?.endedAt)} />
            ) : null}
          </DetailSection>
        ) : null}
      </div>
    </ScrollArea>
  )
}

export function OrderDetails({
  workspaceId,
  order,
  detail,
  detailsLoading,
  detailsError,
  linkedLog,
  linkedLogLoading,
  linkedLogError,
  mode,
  onModeChange,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext = false,
  hasPrev = false,
  onRetryDetails,
  onRetryLog,
}: OrderDetailsProps) {
  const canCheckProvider =
    getTradingProviderOAuthServiceIds(order.provider as TradingProviderId).length > 0
  const providerDetailQuery = useProviderOrderDetail({
    workspaceId,
    orderId: order.id,
    enabled: false,
  })

  if (mode === 'log' && linkedLog) {
    return (
      <LogDetails
        log={linkedLog}
        isOpen
        onClose={onClose}
        onNavigateNext={onNavigateNext}
        onNavigatePrev={onNavigatePrev}
        hasNext={hasNext}
        hasPrev={hasPrev}
      />
    )
  }

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col p-1'>
      <div className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card'>
        <OrderPanelHeader
          order={order}
          mode={mode}
          canCheckProvider={canCheckProvider}
          isCheckingProvider={providerDetailQuery.isFetching}
          onModeChange={onModeChange}
          onCheckProvider={() => void providerDetailQuery.refetch()}
          onClose={onClose}
          onNavigateNext={onNavigateNext}
          onNavigatePrev={onNavigatePrev}
          hasNext={hasNext}
          hasPrev={hasPrev}
        />
        <div className='min-h-0 min-w-0 flex-1'>
          {mode === 'log' ? (
            <div className='flex h-full min-h-0 items-center justify-center p-5 text-center text-muted-foreground text-sm'>
              {!order.logId ? (
                'No log is connected to this order.'
              ) : linkedLogLoading ? (
                <span className='flex items-center gap-2'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Loading workflow log...
                </span>
              ) : (
                <div className='space-y-3'>
                  <AlertCircle className='mx-auto h-5 w-5 text-destructive' />
                  <p>{linkedLogError ?? 'Workflow log unavailable'}</p>
                  <Button size='sm' variant='outline' onClick={onRetryLog}>
                    Retry
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <OrderData
              order={order}
              detail={detail}
              loading={detailsLoading}
              error={detailsError}
              onRetry={onRetryDetails}
              providerDetail={providerDetailQuery.data as ProviderDetailResponse | undefined}
              providerDetailError={providerDetailQuery.error}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function OrderPanelHeader({
  order,
  mode,
  canCheckProvider,
  isCheckingProvider,
  onModeChange,
  onCheckProvider,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext,
  hasPrev,
}: {
  order: RecordsOrder
  mode: RecordsOrderDetailMode
  canCheckProvider: boolean
  isCheckingProvider: boolean
  onModeChange: (mode: RecordsOrderDetailMode) => void
  onCheckProvider: () => void
  onClose: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  hasNext: boolean
  hasPrev: boolean
}) {
  return (
    <div className='z-[9] flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-2'>
      <div className='min-w-0'>
        <h2 className='font-medium text-foreground text-sm'>Order Details</h2>
      </div>
      <div className='flex items-center gap-1'>
        <Button
          size='sm'
          variant={mode === 'log' ? 'secondary' : 'ghost'}
          disabled={!order.logId}
          onClick={() => onModeChange('log')}
        >
          Log detail
        </Button>
        <Button
          size='sm'
          variant={mode === 'order' ? 'secondary' : 'ghost'}
          onClick={() => onModeChange('order')}
        >
          Order data
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='h-7 w-7 p-0'
          disabled={!canCheckProvider || isCheckingProvider}
          onClick={() => {
            onModeChange('order')
            onCheckProvider()
          }}
        >
          {isCheckingProvider ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <RefreshCw className='h-4 w-4' />
          )}
          <span className='sr-only'>Refresh provider order detail</span>
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='h-7 w-7 p-0'
          disabled={!hasPrev}
          onClick={onNavigatePrev}
        >
          <ChevronUp className='h-4 w-4' />
          <span className='sr-only'>Previous order</span>
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='h-7 w-7 p-0'
          disabled={!hasNext}
          onClick={onNavigateNext}
        >
          <ChevronDown className='h-4 w-4' />
          <span className='sr-only'>Next order</span>
        </Button>
        <Button size='icon' variant='ghost' className='h-7 w-7 p-0' onClick={onClose}>
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </Button>
      </div>
    </div>
  )
}
