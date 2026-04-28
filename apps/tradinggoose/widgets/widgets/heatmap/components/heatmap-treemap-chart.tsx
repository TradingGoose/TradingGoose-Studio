'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { resolveHeatmapTileColor } from '@/widgets/widgets/heatmap/utils/color'
import {
  formatHeatmapChange,
  formatHeatmapPercent,
  formatHeatmapPrice,
} from '@/widgets/widgets/heatmap/utils/format'
import {
  computeHeatmapTreemapLayout,
  type HeatmapTreemapInputItem,
} from '@/widgets/widgets/heatmap/utils/treemap-layout'

type HeatmapTreemapChartProps = {
  items: HeatmapTreemapInputItem[]
  isLoading?: boolean
  errorMessage?: string | null
  cappedCount?: number
  totalCount?: number
}

const resolveQuoteChange = (quote: HeatmapTreemapInputItem['quote']) => {
  if (typeof quote?.change === 'number' && Number.isFinite(quote.change)) {
    return quote.change
  }
  if (
    typeof quote?.lastPrice === 'number' &&
    Number.isFinite(quote.lastPrice) &&
    typeof quote.previousClose === 'number' &&
    Number.isFinite(quote.previousClose)
  ) {
    return quote.lastPrice - quote.previousClose
  }
  return undefined
}

const HeatmapTreemapMessage = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-sm'>
    {message}
  </div>
)

export function HeatmapTreemapChart({
  items,
  isLoading = false,
  errorMessage = null,
  cappedCount = 0,
  totalCount,
}: HeatmapTreemapChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateSize = () => {
      const rect = container.getBoundingClientRect()
      setSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      })
    }

    updateSize()
    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  const tiles = useMemo(
    () =>
      computeHeatmapTreemapLayout({
        items,
        width: size.width,
        height: size.height,
      }),
    [items, size.height, size.width]
  )

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (errorMessage) {
    return <HeatmapTreemapMessage message={errorMessage} />
  }

  const resolvedTotalCount = totalCount ?? items.length + cappedCount

  return (
    <div ref={containerRef} className='relative h-full min-h-0 w-full overflow-hidden'>
      {cappedCount > 0 ? (
        <div className='absolute top-1 right-1 z-10 rounded-sm border border-border/70 bg-card/90 px-2 py-1 text-muted-foreground text-xs shadow-sm'>
          Showing first {items.length} of {resolvedTotalCount} listings.
        </div>
      ) : null}
      {tiles.map((tile) => {
        const color = resolveHeatmapTileColor(tile.quote?.changePercent)
        const showSymbol = tile.width >= 44 && tile.height >= 28
        const showPercent = tile.width >= 76 && tile.height >= 48
        const showPrice = tile.width >= 120 && tile.height >= 72
        const sourceText = tile.sourceLabels?.length ? tile.sourceLabels.join(', ') : 'Source'
        const lastPriceText = formatHeatmapPrice(tile.quote?.lastPrice)
        const previousCloseText = formatHeatmapPrice(tile.quote?.previousClose)
        const changeText = formatHeatmapChange(resolveQuoteChange(tile.quote))
        const percentText = formatHeatmapPercent(tile.quote?.changePercent)
        const quoteText = tile.quote?.error
          ? tile.quote.error
          : `Last ${lastPriceText} · Previous ${previousCloseText} · Change ${changeText} · ${percentText}`
        return (
          <Tooltip key={tile.key}>
            <TooltipTrigger asChild>
              <button
                type='button'
                className={cn(
                  'absolute overflow-hidden rounded-sm border p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                  color.className
                )}
                style={{
                  left: tile.x,
                  top: tile.y,
                  width: tile.width,
                  height: tile.height,
                }}
                aria-label={`${tile.name}: ${quoteText}; ${sourceText}`}
              >
                {showSymbol ? (
                  <div className='flex h-full min-h-0 flex-col justify-between gap-1'>
                    <div className='min-w-0 truncate font-semibold text-[12px] leading-4'>
                      {tile.label}
                    </div>
                    {showPercent ? (
                      <div className='min-w-0'>
                        <div className='truncate font-medium text-[12px] leading-4'>
                          {percentText}
                        </div>
                        {showPrice ? (
                          <div className='truncate text-[10px] leading-3 opacity-75'>
                            {lastPriceText}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side='top' className='max-w-[260px] whitespace-normal'>
              <div className='space-y-1'>
                <div className='font-medium'>{tile.name}</div>
                {tile.quote?.error ? (
                  <div>{tile.quote.error}</div>
                ) : (
                  <>
                    <div>Last {lastPriceText}</div>
                    <div>Previous close {previousCloseText}</div>
                    <div>
                      Change {changeText} ({percentText})
                    </div>
                  </>
                )}
                <div className='text-white/75 dark:text-black/70'>{sourceText}</div>
              </div>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
