'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MarketInterval } from '@/providers/market/types'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import {
  DEFAULT_RANGE_PRESETS,
  addRangeToDate,
} from '@/widgets/widgets/data_chart/remapping'
import { chooseIntervalForRange } from '@/widgets/widgets/data_chart/utils'

export const DataChartRangeStrip = ({
  params,
  widgetKey,
  panelId,
  allowedIntervals,
}: {
  params: DataChartWidgetParams
  widgetKey?: string
  panelId?: string
  allowedIntervals: MarketInterval[]
}) => {
  const availablePresets = DEFAULT_RANGE_PRESETS.filter(
    (preset) => !preset.interval || allowedIntervals.includes(preset.interval)
  )
  const selectedRangeId =
    params.dataWindow?.mode === 'range'
      ? availablePresets.find((preset) => {
        const range = params.dataWindow?.range
        return range && preset.range.value === range.value && preset.range.unit === range.unit
      })?.id
      : null

  const handleRangeSelect = (presetId: string) => {
    const preset = availablePresets.find((range) => range.id === presetId)
    if (!preset) return

    const anchor = new Date(0)
    const rangeEnd = addRangeToDate(anchor, preset.range)
    const rangeMs = rangeEnd.getTime() - anchor.getTime()
    const fallbackInterval = params.interval
    const presetInterval = preset.interval
    const interval =
      presetInterval ?? chooseIntervalForRange(rangeMs, allowedIntervals) ?? fallbackInterval

    emitDataChartParamsChange({
      params: {
        interval,
        start: null,
        end: null,
        dataWindow: {
          mode: 'range',
          range: preset.range,
          rangeInterval: interval,
        },
      },
      panelId,
      widgetKey,
    })
  }

  return (
    <div className='border-t border-border/60 bg-background p-1'>
      <div className='w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        <Tabs
          value={selectedRangeId ?? ''}
          onValueChange={handleRangeSelect}
          className='w-max'
        >
          <TabsList className='h-7 w-max justify-start gap-1 bg-muted/60 p-1'>
            {availablePresets.map((preset) => (
              <TabsTrigger
                key={preset.id}
                value={preset.id}
                className='px-2 py-1 text-xs font-medium transition-colors data-[state=active]:shadow-sm'
              >
                {preset.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
