'use client'

import { CandlestickChart, Clock } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { MarketInterval } from '@/providers/market/types'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import { IndicatorDropdown } from '@/widgets/widgets/components/pine-indicator-dropdown'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { CANDLE_TYPE_OPTIONS } from '@/widgets/widgets/data_chart/options'
import { formatIntervalLabel } from '@/widgets/widgets/data_chart/series-data'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import { buildIndicatorRefs } from '@/widgets/widgets/data_chart/utils/indicator-refs'

type DataChartIntervalDropdownProps = {
  params: DataChartWidgetParams
  interval?: MarketInterval | string
  allowedIntervals: MarketInterval[]
  supportsInterval: boolean
  panelId?: string
  widgetKey?: string
}

export const DataChartIntervalDropdown = ({
  params,
  interval,
  allowedIntervals,
  supportsInterval,
  panelId,
  widgetKey,
}: DataChartIntervalDropdownProps) => {
  const handleIntervalSelect = (nextInterval: string) => {
    const {
      window: _window,
      fallbackWindow: _fallbackWindow,
      ...nextDataBase
    } = (params.data ?? {}) as Record<string, unknown>
    const nextData = { ...nextDataBase }

    const {
      rangePresetId: _rangePresetId,
      start: _start,
      end: _end,
      ...nextViewBase
    } = (params.view ?? {}) as Record<string, unknown>
    const nextView = { ...nextViewBase, interval: nextInterval }

    emitDataChartParamsChange({
      params: {
        data: nextData,
        view: nextView,
        runtime: { refreshAt: Date.now() },
      },
      panelId,
      widgetKey,
    })
  }

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className={widgetHeaderIconButtonClassName()}
                disabled={!supportsInterval || allowedIntervals.length === 0}
              >
                <Clock className='h-3.5 w-3.5' />
                <span className='sr-only'>Select interval</span>
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>Interval</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className={cn(widgetHeaderMenuContentClassName, 'w-44')}>
        {allowedIntervals.length === 0 ? (
          <div className='px-2 py-2 text-muted-foreground text-xs'>No intervals</div>
        ) : (
          allowedIntervals.map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={(event) => {
                event.preventDefault()
                handleIntervalSelect(option)
              }}
              className={cn(
                widgetHeaderMenuItemClassName,
                interval === option && 'bg-muted text-foreground'
              )}
            >
              {formatIntervalLabel(option)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type DataChartCandleTypeDropdownProps = {
  params: DataChartWidgetParams
  candleType?: string
  panelId?: string
  widgetKey?: string
}

export const DataChartCandleTypeDropdown = ({
  params,
  candleType,
  panelId,
  widgetKey,
}: DataChartCandleTypeDropdownProps) => {
  const selectedOption =
    CANDLE_TYPE_OPTIONS.find((option) => option.id === candleType) ?? CANDLE_TYPE_OPTIONS[0]
  const SelectedIcon = selectedOption?.icon

  const handleCandleType = (nextType: string) => {
    emitDataChartParamsChange({
      params: {
        view: {
          ...(params.view ?? {}),
          candleType: nextType,
        },
      },
      panelId,
      widgetKey,
    })
  }

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type='button' className={widgetHeaderIconButtonClassName()}>
              {SelectedIcon ? (
                <SelectedIcon className='h-3.5 w-3.5' />
              ) : (
                <CandlestickChart className='h-3.5 w-3.5' />
              )}
              <span className='sr-only'>Candle style</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>Candle style</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className={cn(widgetHeaderMenuContentClassName, 'w-48')}>
        {CANDLE_TYPE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={(event) => {
              event.preventDefault()
              handleCandleType(option.id)
            }}
            className={cn(
              widgetHeaderMenuItemClassName,
              'items-center gap-2',
              candleType === option.id && 'bg-muted text-foreground'
            )}
          >
            <option.icon className='h-3.5 w-3.5' />
            <span className='flex-1'>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type DataChartChartControlsProps = {
  workspaceId?: string | null
  params: DataChartWidgetParams
  interval?: MarketInterval | string
  allowedIntervals: MarketInterval[]
  supportsInterval: boolean
  panelId?: string
  widgetKey?: string
}

export const DataChartChartControls = ({
  workspaceId,
  params,
  interval,
  allowedIntervals,
  supportsInterval,
  panelId,
  widgetKey,
}: DataChartChartControlsProps) => {
  const candleType = params.view?.candleType

  const handleIndicatorChange = (nextIds: string[]) => {
    const restView = { ...(params.view ?? {}) } as Record<string, unknown>
    emitDataChartParamsChange({
      params: {
        view: {
          ...restView,
          pineIndicators: buildIndicatorRefs(
            nextIds,
            Array.isArray(params.view?.pineIndicators) ? params.view?.pineIndicators : []
          ),
        },
      },
      panelId,
      widgetKey,
    })
  }

  const selectedIndicatorIds = (params.view?.pineIndicators ?? []).map((indicator) => indicator.id)

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <DataChartIntervalDropdown
        params={params}
        interval={interval}
        allowedIntervals={allowedIntervals}
        supportsInterval={supportsInterval}
        panelId={panelId}
        widgetKey={widgetKey}
      />
      <DataChartCandleTypeDropdown
        params={params}
        candleType={candleType}
        panelId={panelId}
        widgetKey={widgetKey}
      />
      <IndicatorDropdown
        workspaceId={workspaceId}
        value={selectedIndicatorIds}
        onChange={handleIndicatorChange}
        align='end'
        selectionMode='multiple'
        includeDefaults
      />
    </div>
  )
}
