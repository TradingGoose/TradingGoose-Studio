'use client'

import type React from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LogDetails } from '@/app/workspace/[workspaceId]/records/components/log-details/log-details'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  getExecutionPrice,
  titleCase,
  uppercase,
} from './order-formatters'
import { OrderProviderRefresh } from './order-provider-refresh'
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

const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className='grid grid-cols-[150px_1fr] gap-3 border-b py-2 last:border-b-0'>
    <div className='text-muted-foreground text-xs'>{label}</div>
    <div className='min-w-0 break-words text-sm'>{value ?? '—'}</div>
  </div>
)

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <details className='rounded-md border bg-card/40'>
      <summary className='cursor-pointer px-3 py-2 font-medium text-sm'>{title}</summary>
      <pre className='max-h-[360px] overflow-auto border-t bg-muted/30 p-3 text-xs'>
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
    </details>
  )
}

function OrderData({
  order,
  detail,
  loading,
  error,
  onRetry,
}: {
  order: RecordsOrder
  detail: RecordsOrder | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const active = detail ?? order
  const executionPrice = getExecutionPrice(active)

  return (
    <ScrollArea className='h-full'>
      <div className='space-y-5 p-5'>
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

        <section className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='font-semibold text-base'>
              {active.listing.symbol ?? 'Unknown listing'}
            </h2>
            <OrderStatusBadge status={active.status} />
            <Badge variant='secondary'>{titleCase(active.submissionSource)}</Badge>
            <Badge variant={active.workflowLogId ? 'default' : 'outline'}>
              {active.workflowLogId ? 'Workflow log connected' : 'No workflow log connected'}
            </Badge>
          </div>
          <p className='text-muted-foreground text-sm'>
            {active.message ?? 'Saved order submission record'}
          </p>
        </section>

        <section className='rounded-md border bg-card/40 p-3'>
          <DetailRow label='App order id' value={<code>{active.id}</code>} />
          <DetailRow label='Provider order id' value={active.providerOrderId ?? '—'} />
          <DetailRow label='Client order id' value={active.clientOrderId ?? '—'} />
          <DetailRow label='Provider' value={titleCase(active.provider)} />
          <DetailRow label='Environment' value={titleCase(active.environment)} />
          <DetailRow label='Trading account' value={active.accountId ?? '—'} />
          <DetailRow label='Submission source' value={titleCase(active.submissionSource)} />
          <DetailRow label='Status' value={titleCase(active.status)} />
          <DetailRow label='Side' value={titleCase(active.side)} />
          <DetailRow label='Order type' value={titleCase(active.orderType)} />
          <DetailRow label='Time in force' value={uppercase(active.timeInForce)} />
          <DetailRow label='Quantity' value={formatNumber(active.quantity)} />
          <DetailRow label='Filled quantity' value={formatNumber(active.filledQuantity)} />
          <DetailRow label='Remaining quantity' value={formatNumber(active.remainingQuantity)} />
          <DetailRow label={executionPrice.label} value={executionPrice.value} />
          <DetailRow label='Fill price' value={formatMoney(active.fillPrice)} />
          <DetailRow label='Average fill price' value={formatMoney(active.averageFillPrice)} />
          <DetailRow label='Submitted price' value={formatMoney(active.submittedPrice)} />
          <DetailRow label='Fee' value={formatMoney(active.fee)} />
          <DetailRow label='Recorded at' value={formatDateTime(active.recordedAt)} />
          <DetailRow label='Submitted at' value={formatDateTime(active.submittedAt)} />
          <DetailRow label='Updated at' value={formatDateTime(active.updatedAt)} />
          <DetailRow label='Filled at' value={formatDateTime(active.filledAt)} />
        </section>

        <section className='rounded-md border bg-card/40 p-3'>
          <DetailRow label='Workflow log id' value={active.workflowLogId ?? '—'} />
          <DetailRow label='Log execution id' value={active.linkedLog?.executionId ?? '—'} />
          <DetailRow label='Workflow name' value={active.linkedLog?.workflowName ?? '—'} />
          <DetailRow label='Workflow execution id' value={active.workflowExecutionId ?? '—'} />
        </section>

        <div className='space-y-3'>
          <JsonBlock title='listingIdentity' value={(active as any).listingIdentity} />
          <JsonBlock title='request' value={active.request} />
          <JsonBlock title='response' value={active.response} />
          <JsonBlock title='normalizedOrder' value={active.normalizedOrder} />
        </div>
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
  const hasLinkedLog = Boolean(order.workflowLogId)

  if (mode === 'log') {
    if (!hasLinkedLog) {
      return (
        <div className='flex h-full flex-col'>
          <OrderPanelHeader
            order={order}
            mode={mode}
            onModeChange={onModeChange}
            onClose={onClose}
            onNavigateNext={onNavigateNext}
            onNavigatePrev={onNavigatePrev}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />
          <div className='flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-sm'>
            No workflow log is connected to this order.
          </div>
        </div>
      )
    }

    if (linkedLogLoading) {
      return (
        <div className='flex h-full flex-col'>
          <OrderPanelHeader
            order={order}
            mode={mode}
            onModeChange={onModeChange}
            onClose={onClose}
            onNavigateNext={onNavigateNext}
            onNavigatePrev={onNavigatePrev}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />
          <div className='flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm'>
            <Loader2 className='h-4 w-4 animate-spin' />
            Loading workflow log...
          </div>
        </div>
      )
    }

    if (linkedLogError || !linkedLog) {
      return (
        <div className='flex h-full flex-col'>
          <OrderPanelHeader
            order={order}
            mode={mode}
            onModeChange={onModeChange}
            onClose={onClose}
            onNavigateNext={onNavigateNext}
            onNavigatePrev={onNavigatePrev}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />
          <div className='flex flex-1 items-center justify-center p-6'>
            <div className='space-y-3 text-center text-sm'>
              <AlertCircle className='mx-auto h-5 w-5 text-destructive' />
              <p className='text-muted-foreground'>
                {linkedLogError ?? 'Workflow log unavailable'}
              </p>
              <Button size='sm' variant='outline' onClick={onRetryLog}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      )
    }

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
    <div className='flex h-full flex-col'>
      <OrderPanelHeader
        order={order}
        mode={mode}
        onModeChange={onModeChange}
        onClose={onClose}
        onNavigateNext={onNavigateNext}
        onNavigatePrev={onNavigatePrev}
        hasNext={hasNext}
        hasPrev={hasPrev}
      />
      {mode === 'provider' ? (
        <ScrollArea className='h-full'>
          <div className='p-5'>
            <OrderProviderRefresh
              workspaceId={workspaceId}
              order={order}
              active={mode === 'provider'}
            />
          </div>
        </ScrollArea>
      ) : (
        <OrderData
          order={order}
          detail={detail}
          loading={detailsLoading}
          error={detailsError}
          onRetry={onRetryDetails}
        />
      )}
    </div>
  )
}

function OrderPanelHeader({
  order,
  mode,
  onModeChange,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext,
  hasPrev,
}: {
  order: RecordsOrder
  mode: RecordsOrderDetailMode
  onModeChange: (mode: RecordsOrderDetailMode) => void
  onClose: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  hasNext: boolean
  hasPrev: boolean
}) {
  return (
    <div className='flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card/40 p-3'>
      <div className='min-w-0'>
        <div className='truncate font-medium text-sm'>{order.listing.symbol ?? order.id}</div>
        <div className='truncate text-muted-foreground text-xs'>
          {order.providerOrderId ?? order.id}
        </div>
      </div>
      <div className='flex items-center gap-1'>
        <Button
          size='sm'
          variant={mode === 'log' ? 'secondary' : 'ghost'}
          disabled={!order.workflowLogId}
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
          size='sm'
          variant={mode === 'provider' ? 'secondary' : 'ghost'}
          onClick={() => onModeChange('provider')}
        >
          Provider
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='h-8 w-8'
          disabled={!hasPrev}
          onClick={onNavigatePrev}
        >
          <ChevronLeft className='h-4 w-4' />
          <span className='sr-only'>Previous order</span>
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='h-8 w-8'
          disabled={!hasNext}
          onClick={onNavigateNext}
        >
          <ChevronRight className='h-4 w-4' />
          <span className='sr-only'>Next order</span>
        </Button>
        <Button size='icon' variant='ghost' className='h-8 w-8' onClick={onClose}>
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </Button>
      </div>
    </div>
  )
}
