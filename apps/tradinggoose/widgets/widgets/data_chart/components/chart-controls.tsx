'use client'

import { useMemo } from 'react'
import { CandlestickChart, Clock } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { IndicatorDropdown } from '@/widgets/widgets/components/indicator-dropdown'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import { useCustomIndicatorsStore } from '@/stores/custom-indicators/store'
import { buildIndicatorRefs } from '@/widgets/widgets/data_chart/utils'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import { CANDLE_TYPE_OPTIONS } from '@/widgets/widgets/data_chart/types'
import { DEFAULT_RANGE_PRESETS, formatIntervalLabel } from '@/widgets/widgets/data_chart/remapping'
import type { MarketInterval } from '@/providers/market/types'

type DataChartChartControlsProps = {
  workspaceId?: string | null
  widgetKey?: string
  panelId?: string
  params: DataChartWidgetParams
  interval?: MarketInterval | string
  allowedIntervals: MarketInterval[]
  supportsInterval: boolean
}

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
    const fallbackRange = DEFAULT_RANGE_PRESETS[0]?.range
    emitDataChartParamsChange({
      params: {
        data: {
          ...(params.data ?? {}),
          interval: nextInterval,
          window: fallbackRange ? { mode: 'range', range: fallbackRange } : undefined,
          fallbackWindow: undefined,
        },
      },
      panelId,
      widgetKey,
    })
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent side='top'>Interval</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className={cn(widgetHeaderMenuContentClassName, 'w-44')}>
        {allowedIntervals.length === 0 ? (
          <div className='px-2 py-2 text-xs text-muted-foreground'>No intervals</div>
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
    <DropdownMenu>
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

type DataChartIndicatorsDropdownProps = {
  workspaceId?: string | null
  params: DataChartWidgetParams
  panelId?: string
  widgetKey?: string
}

export const DataChartIndicatorsDropdown = ({
  workspaceId,
  params,
  panelId,
  widgetKey,
}: DataChartIndicatorsDropdownProps) => {
  const customIndicators = useCustomIndicatorsStore((state) =>
    workspaceId ? state.getAllIndicators(workspaceId) : []
  )
  const customIndicatorIdSet = useMemo(
    () => new Set(customIndicators.map((indicator) => indicator.id)),
    [customIndicators]
  )

  const handleIndicatorChange = (nextIds: string[]) => {
    const restView = { ...(params.view ?? {}) } as Record<string, unknown>
    emitDataChartParamsChange({
      params: {
        view: {
          ...restView,
          indicators: buildIndicatorRefs(nextIds, customIndicatorIdSet),
        },
      },
      panelId,
      widgetKey,
    })
  }

  const selectedIndicatorIds = (params.view?.indicators ?? []).map((indicator) => indicator.id)

  return (
    <IndicatorDropdown
      workspaceId={workspaceId}
      value={selectedIndicatorIds}
      onChange={handleIndicatorChange}
      align='end'
      widgetKey={widgetKey}
    />
  )
}

export const DataChartChartControls = ({
  workspaceId,
  widgetKey,
  panelId,
  params,
  interval,
  allowedIntervals,
  supportsInterval,
}: DataChartChartControlsProps) => {
  const candleType = params.view?.candleType

  return (
    <div className='flex items-center gap-2'>
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
      <DataChartIndicatorsDropdown
        workspaceId={workspaceId}
        params={params}
        panelId={panelId}
        widgetKey={widgetKey}
      />
    </div>
  )
}
