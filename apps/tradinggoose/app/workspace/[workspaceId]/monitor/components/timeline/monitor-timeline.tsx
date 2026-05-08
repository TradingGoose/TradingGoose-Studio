'use client'

import type { ExecutionMonitorTimelineZoom, ExecutionMonitorViewConfig } from '../view/view-config'
import { Gantt } from './gantt'
import type { MonitorTimelineGroup } from './timeline-state'

type MonitorTimelineProps = {
  groups: MonitorTimelineGroup[]
  config: ExecutionMonitorViewConfig
  selectedExecutionLogId: string | null
  controlsDisabled: boolean
  onSelectExecution: (logId: string) => void
  onTimelineZoomChange?: (zoom: ExecutionMonitorTimelineZoom) => void
  onTimelineScaleChange?: (scale: number) => void
}

export function MonitorTimeline({
  groups,
  config,
  selectedExecutionLogId,
  controlsDisabled,
  onSelectExecution,
  onTimelineZoomChange,
  onTimelineScaleChange,
}: MonitorTimelineProps) {
  return (
    <Gantt
      groups={groups.map((group) => ({
        id: group.id,
        label: group.label,
        aggregates: group.aggregates,
        items: group.items.map((item) => ({
          id: item.id,
          title: item.title,
          startAt: item.startAt,
          endAt: item.endAt,
          isOrphaned: item.item.isOrphaned,
          isPartial: item.item.isPartial,
          color:
            item.item.outcome === 'error'
              ? '#ef4444'
              : item.item.outcome === 'running'
                ? '#3b82f6'
                : item.item.outcome === 'skipped'
                  ? '#f59e0b'
                  : '#22c55e',
        })),
      }))}
      zoom={config.timeline.zoom}
      scale={config.timeline.scale}
      timezone={config.timezone}
      selectedItemId={selectedExecutionLogId}
      showTodayMarker={config.timeline.markers.today}
      showIntervalBoundaries={config.timeline.markers.intervalBoundaries}
      controlsDisabled={controlsDisabled}
      onSelectItem={onSelectExecution}
      onZoomChange={onTimelineZoomChange}
      onScaleChange={onTimelineScaleChange}
    />
  )
}
