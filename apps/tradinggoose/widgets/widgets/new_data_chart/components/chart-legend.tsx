'use client'

import type { Ref } from 'react'
import type { ListingOption } from '@/lib/listing/identity'
import { ListingOverlay } from '@/widgets/widgets/new_data_chart/components/listing-overlay'
import type { LegendData } from '@/widgets/widgets/new_data_chart/hooks/use-chart-legend'

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
}: {
  legend: LegendData | null
  listingLabel?: string | null
  listing?: ListingOption | null
  intervalLabel?: string | null
  isResolving?: boolean
  containerRef?: Ref<HTMLDivElement>
}) => {
  if (!legend) return null

  const colorClass = resolveDirectionClass(legend.direction)
  const isValueOnly =
    legend.value !== undefined &&
    legend.open === undefined &&
    legend.high === undefined &&
    legend.low === undefined &&
    legend.close === undefined
  const openValue = legend.open ?? '--'
  const highValue = legend.high ?? '--'
  const lowValue = legend.low ?? '--'
  const closeValue = legend.close ?? '--'
  const valueLabel = legend.value ?? '--'

  const showListingOverlay = Boolean(listing || isResolving)

  return (
    <div
      ref={containerRef}
      className='pointer-events-none absolute left-1 top-0 z-10 py-1 gap-2 text-sm'
    >
      {showListingOverlay ? (
        <div className='mb-1'>
          <ListingOverlay
            listing={listing ?? null}
            intervalLabel={intervalLabel}
            isResolving={isResolving}
          />
        </div>
      ) : listingLabel ? (
        <div className='text-sm font-semibold text-foreground'>{listingLabel}</div>
      ) : null}
      <div className='flex flex-wrap items-center gap-3 text-xs font-bold text-foreground'>
        <span className='text-muted-foreground'>{legend.time}</span>
        {isValueOnly ? (
          <span>
            Value: <span className={colorClass}>{valueLabel}</span>
          </span>
        ) : (
          <>
            <span>
              O: <span className={colorClass}>{openValue}</span>
            </span>
            <span>
              H: <span className={colorClass}>{highValue}</span>
            </span>
            <span>
              L: <span className={colorClass}>{lowValue}</span>
            </span>
            <span>
              C: <span className={colorClass}>{closeValue}</span>
            </span>
          </>
        )}
        {legend.change ? <span className={colorClass}>{legend.change}</span> : null}
      </div>
    </div>
  )
}
