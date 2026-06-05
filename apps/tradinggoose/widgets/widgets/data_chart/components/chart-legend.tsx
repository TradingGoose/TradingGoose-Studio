'use client'

import type { Ref } from 'react'
import type { ListingOption } from '@/lib/listing/identity'
import { ListingOverlay } from '@/widgets/widgets/data_chart/components/listing-overlay'
import { useDataChartCopy } from '@/widgets/widgets/data_chart/copy'
import type { LegendData } from '@/widgets/widgets/data_chart/hooks/use-chart-legend'

const resolveDirectionClass = (direction?: LegendData['direction']) => {
  if (direction === 'down') return 'text-rose-500'
  if (direction === 'up') return 'text-emerald-500'
  return 'text-foreground'
}

export const ChartLegend = ({
  legend,
  listingLabel,
  listing,
  intervalLabel,
  isResolving,
  containerRef,
  leftInsetPx = 3,
}: {
  legend: LegendData | null
  listingLabel?: string | null
  listing?: ListingOption | null
  intervalLabel?: string | null
  isResolving?: boolean
  containerRef?: Ref<HTMLDivElement>
  leftInsetPx?: number
}) => {
  const copy = useDataChartCopy()
  const showListingOverlay = Boolean(listing || isResolving)
  if (!legend && !showListingOverlay) return null

  const colorClass = legend ? resolveDirectionClass(legend.direction) : 'text-foreground'
  const isValueOnly =
    legend?.value !== undefined &&
    legend?.open === undefined &&
    legend?.high === undefined &&
    legend?.low === undefined &&
    legend?.close === undefined
  const openValue = legend?.open ?? '--'
  const highValue = legend?.high ?? '--'
  const lowValue = legend?.low ?? '--'
  const closeValue = legend?.close ?? '--'
  const valueLabel = legend?.value ?? '--'

  return (
    <div
      ref={containerRef}
      className='pointer-events-none absolute top-0 right-0 overflow-hidden text-sm'
      style={{ left: `${leftInsetPx}px` }}
    >
      {showListingOverlay ? (
        <div className='min-w-0 max-w-full overflow-hidden'>
          <ListingOverlay
            listing={listing ?? null}
            intervalLabel={intervalLabel}
            isResolving={isResolving}
          />
        </div>
      ) : listingLabel ? (
        <div className='max-w-full truncate font-semibold text-foreground text-sm'>
          {listingLabel}
        </div>
      ) : null}
      {legend ? (
        <div className='px-1 flex min-w-0 max-w-full flex-wrap items-center gap-3 overflow-hidden font-bold text-foreground text-xs'>
          <span className='text-muted-foreground'>{legend.time}</span>
          {isValueOnly ? (
            <span>
              {copy.legend.value} <span className={colorClass}>{valueLabel}</span>
            </span>
          ) : (
            <>
              <span>
                {copy.legend.open} <span className={colorClass}>{openValue}</span>
              </span>
              <span>
                {copy.legend.high} <span className={colorClass}>{highValue}</span>
              </span>
              <span>
                {copy.legend.low} <span className={colorClass}>{lowValue}</span>
              </span>
              <span>
                {copy.legend.close} <span className={colorClass}>{closeValue}</span>
              </span>
            </>
          )}
          {legend.change ? <span className={colorClass}>{legend.change}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
