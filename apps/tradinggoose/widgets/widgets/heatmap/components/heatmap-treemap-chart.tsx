'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { buildListingDisplay, getFlagData } from '@/widgets/widgets/data_chart/utils/listing-utils'
import { resolveHeatmapTileColor } from '@/widgets/widgets/heatmap/utils/color'
import {
  formatHeatmapChange,
  formatHeatmapPercent,
  formatHeatmapPrice,
} from '@/widgets/widgets/heatmap/utils/format'
import {
  buildHeatmapTreemapLayout,
  type HeatmapTreemapInputItem,
  type HeatmapTreemapLeafNode,
  type HeatmapTreemapNode,
  type HeatmapTreemapTile,
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

const resolveTileIconSize = (width: number, height: number) => {
  const minDimension = Math.min(width, height)
  if (minDimension < 24) return 0
  return Math.max(14, Math.min(64, Math.floor(minDimension * 0.42)))
}

const resolveTileDisplay = (tile: HeatmapTreemapTile) => {
  if (!tile.resolvedListing) {
    return {
      symbolParts: { base: tile.label, quote: '' },
      symbolText: tile.label,
      flagData: null,
      flagCountryCode: '',
    }
  }

  const { listingSymbolParts, listingSymbolText } = buildListingDisplay(tile.resolvedListing)
  const flagData =
    tile.resolvedListing.listing_type === 'default'
      ? getFlagData(tile.resolvedListing.countryCode)
      : null
  return {
    symbolParts: listingSymbolParts,
    symbolText: listingSymbolText,
    flagData,
    flagCountryCode: tile.resolvedListing.countryCode?.trim().toUpperCase() ?? '',
  }
}

const HeatmapTreemapMessage = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-sm'>
    {message}
  </div>
)

type ElementSize = {
  width: number
  height: number
}

const DEFAULT_CHART_SIZE: ElementSize = { width: 320, height: 180 }
const EMPTY_SIZE: ElementSize = { width: 0, height: 0 }

const readElementSize = (element: HTMLElement | null) => {
  if (!element) return { width: 0, height: 0 }
  const rect = element.getBoundingClientRect()
  return {
    width: Math.max(0, Math.floor(rect.width), element.clientWidth),
    height: Math.max(0, Math.floor(rect.height), element.clientHeight),
  }
}

const readEntrySize = (entry?: ResizeObserverEntry) => {
  if (!entry) return { width: 0, height: 0 }
  return {
    width: Math.max(0, Math.floor(entry.contentRect.width)),
    height: Math.max(0, Math.floor(entry.contentRect.height)),
  }
}

const useObservedElementSize = <ElementType extends HTMLElement>(
  fallbackSize: ElementSize,
  options: { observeParent?: boolean } = {}
) => {
  const elementRef = useRef<ElementType | null>(null)
  const [size, setSize] = useState(fallbackSize)
  const observeParent = options.observeParent ?? false

  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element) return

    const updateSize = (entry?: ResizeObserverEntry) => {
      const entrySize = readEntrySize(entry)
      const elementSize = readElementSize(element)
      const parentSize = observeParent ? readElementSize(element.parentElement) : EMPTY_SIZE
      setSize((currentSize) => {
        const measuredWidth = Math.max(entrySize.width, elementSize.width, parentSize.width)
        const measuredHeight = Math.max(entrySize.height, elementSize.height, parentSize.height)
        const nextSize = {
          width: measuredWidth || fallbackSize.width || currentSize.width,
          height: measuredHeight || fallbackSize.height || currentSize.height,
        }

        return currentSize.width === nextSize.width && currentSize.height === nextSize.height
          ? currentSize
          : nextSize
      })
    }

    updateSize()
    const frame = window.requestAnimationFrame(() => updateSize())
    if (typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(frame)
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateSize(entry)
      }
    })
    resizeObserver.observe(element)
    if (observeParent && element.parentElement) {
      resizeObserver.observe(element.parentElement)
    }
    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [fallbackSize.height, fallbackSize.width, observeParent])

  return [elementRef, size] as const
}

const HeatmapTileButton = ({ node }: { node: HeatmapTreemapLeafNode }) => {
  const tile = node.tile
  const tileWidth = node.width
  const tileHeight = node.height
  const color = resolveHeatmapTileColor(tile.quote?.changePercent)
  const showSymbol = tileWidth >= 44 && tileHeight >= 28
  const showPercent = tileWidth >= 76 && tileHeight >= 48
  const showPrice = tileWidth >= 120 && tileHeight >= 72
  const iconUrl = tile.resolvedListing?.iconUrl?.trim()
  const iconSize = iconUrl ? resolveTileIconSize(tileWidth, tileHeight) : 0
  const { symbolParts, symbolText, flagData, flagCountryCode } = resolveTileDisplay(tile)
  const flagImageUrl = flagData
    ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${flagData.codepoints}.svg`
    : null
  const sourceText = tile.sourceLabels?.length ? tile.sourceLabels.join(', ') : 'Source'
  const lastPriceText = formatHeatmapPrice(tile.quote?.lastPrice)
  const previousCloseText = formatHeatmapPrice(tile.quote?.previousClose)
  const changeText = formatHeatmapChange(resolveQuoteChange(tile.quote))
  const percentText = formatHeatmapPercent(tile.quote?.changePercent)
  const quoteText = tile.quote?.error
    ? tile.quote.error
    : `Last ${lastPriceText} · Previous ${previousCloseText} · Change ${changeText} · ${percentText}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          className={cn(
            'relative h-full w-full overflow-hidden rounded-sm border p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
            color.className
          )}
          aria-label={`${tile.name}: ${quoteText}; ${sourceText}`}
        >
          {iconUrl && iconSize > 0 ? (
            <img
              src={iconUrl}
              alt=''
              aria-hidden='true'
              className='-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 z-0 rounded-md border border-border/70 object-contain drop-shadow-lg'
              style={{
                width: iconSize,
                height: iconSize,
              }}
            />
          ) : null}
          {showSymbol ? (
            <div className='relative z-10 flex h-full min-h-0 flex-col justify-between gap-1'>
              <div className='min-w-0'>
                <div className='flex min-w-0 items-center gap-1'>
                  <div className='min-w-0 truncate font-semibold text-[12px] leading-4'>
                    <span>{symbolParts.base || symbolText}</span>
                    {symbolParts.quote ? (
                      <span className='font-medium opacity-75'>/{symbolParts.quote}</span>
                    ) : null}
                  </div>
                  {flagImageUrl ? (
                    <img
                      src={flagImageUrl}
                      alt={`${flagCountryCode} flag`}
                      className='h-3.5 w-3.5 shrink-0'
                      loading='lazy'
                    />
                  ) : null}
                </div>
              </div>
              {showPercent ? (
                <div className='min-w-0'>
                  <div className='truncate font-medium text-[12px] leading-4'>{percentText}</div>
                  {showPrice ? (
                    <div className='truncate text-[10px] leading-3 opacity-75'>{lastPriceText}</div>
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
}

const HeatmapTreemapPanelNode = ({ node }: { node: HeatmapTreemapNode }) => {
  if (node.type === 'leaf') {
    return <HeatmapTileButton node={node} />
  }

  return (
    <ResizablePanelGroup
      key={node.key}
      direction={node.direction}
      className='gap-0.5 h-full min-h-0 w-full min-w-0 overflow-hidden'
    >
      {node.children.map((child, index) => (
        <ResizablePanel
          key={`${node.key}-${child.key}`}
          id={`${node.key}-${child.key}`}
          order={index + 1}
          defaultSize={node.defaultSizes[index]}
          minSize={0}
          className='min-h-0 min-w-0 overflow-hidden'
        >
          <HeatmapTreemapPanelNode node={child} />
        </ResizablePanel>
      ))}
    </ResizablePanelGroup>
  )
}

export function HeatmapTreemapChart({
  items,
  isLoading = false,
  errorMessage = null,
  cappedCount = 0,
  totalCount,
}: HeatmapTreemapChartProps) {
  const [containerRef, size] = useObservedElementSize<HTMLDivElement>(DEFAULT_CHART_SIZE, {
    observeParent: true,
  })

  const layout = useMemo(
    () =>
      buildHeatmapTreemapLayout({
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
    <div ref={containerRef} className='relative h-full w-full overflow-hidden'>
      {cappedCount > 0 ? (
        <div className='absolute top-1 right-1 z-10 rounded-sm border border-border/70 bg-card/90 px-2 py-1 text-muted-foreground text-xs shadow-sm'>
          Showing first {items.length} of {resolvedTotalCount} listings.
        </div>
      ) : null}
      {layout ? <HeatmapTreemapPanelNode key={layout.key} node={layout} /> : null}
    </div>
  )
}
