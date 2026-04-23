'use client'

import { ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import type { MonitorRoadmapGroup } from './roadmap-state'
import { KiboGantt } from './kibo-gantt'
import {
  MAX_MONITOR_TIMELINE_ZOOM,
  MIN_MONITOR_TIMELINE_ZOOM,
  MONITOR_TIMELINE_RANGES,
  MONITOR_TIMELINE_ZOOM_STEP,
  type MonitorTimelineRange,
} from './view-config'

type MonitorRoadmapProps = {
  groups: MonitorRoadmapGroup[]
  range: MonitorTimelineRange
  zoom: number
  selectedMonitorId: string | null
  onRangeChange: (range: MonitorTimelineRange) => void
  onSelectMonitor: (monitorId: string) => void
  onZoomChange: (zoom: number) => void
}

export function MonitorRoadmap({
  groups,
  range,
  zoom,
  selectedMonitorId,
  onRangeChange,
  onSelectMonitor,
  onZoomChange,
}: MonitorRoadmapProps) {
  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/60 px-3 py-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='text-muted-foreground text-xs uppercase tracking-[0.14em]'>Timeline</div>

          <div className='inline-flex h-8 items-center rounded-md border bg-background p-1'>
            {MONITOR_TIMELINE_RANGES.map((rangeOption) => (
              <Button
                key={rangeOption}
                variant='ghost'
                size='sm'
                className={
                  range === rangeOption
                    ? 'h-6 bg-accent px-2 text-xs text-foreground'
                    : 'h-6 px-2 text-muted-foreground text-xs'
                }
                onClick={() => onRangeChange(rangeOption)}
              >
                {rangeOption === 'daily'
                  ? 'Day'
                  : rangeOption === 'monthly'
                    ? 'Month'
                    : 'Quarter'}
              </Button>
            ))}
          </div>
        </div>

        <div className='flex min-w-[240px] flex-1 items-center justify-end gap-2 sm:max-w-[360px]'>
          <Button
            variant='outline'
            size='icon'
            className='h-8 w-8 shrink-0'
            onClick={() => onZoomChange(Math.max(MIN_MONITOR_TIMELINE_ZOOM, zoom - MONITOR_TIMELINE_ZOOM_STEP))}
            disabled={zoom <= MIN_MONITOR_TIMELINE_ZOOM}
          >
            <ZoomOut className='h-4 w-4' />
            <span className='sr-only'>Zoom out timeline</span>
          </Button>

          <Slider
            aria-label='Timeline zoom'
            className='w-full'
            min={MIN_MONITOR_TIMELINE_ZOOM}
            max={MAX_MONITOR_TIMELINE_ZOOM}
            step={MONITOR_TIMELINE_ZOOM_STEP}
            value={[zoom]}
            onValueChange={(value) => {
              const nextZoom = value[0]

              if (typeof nextZoom === 'number') {
                onZoomChange(nextZoom)
              }
            }}
          />

          <div className='w-12 shrink-0 text-right font-medium text-muted-foreground text-xs'>
            {zoom}%
          </div>

          <Button
            variant='outline'
            size='icon'
            className='h-8 w-8 shrink-0'
            onClick={() => onZoomChange(Math.min(MAX_MONITOR_TIMELINE_ZOOM, zoom + MONITOR_TIMELINE_ZOOM_STEP))}
            disabled={zoom >= MAX_MONITOR_TIMELINE_ZOOM}
          >
            <ZoomIn className='h-4 w-4' />
            <span className='sr-only'>Zoom in timeline</span>
          </Button>
        </div>
      </div>

      <div className='min-h-0 flex-1'>
        <KiboGantt
          groups={groups.map((group) => ({
            id: group.id,
            label: group.label,
            items: group.items,
          }))}
          range={range}
          zoom={zoom}
          selectedItemId={selectedMonitorId}
          onSelectItem={onSelectMonitor}
        />
      </div>
    </div>
  )
}
