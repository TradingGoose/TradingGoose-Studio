import { type MonitorBoardColumn, getMonitorStatusColor } from './board-state'
import { parseIntervalDurationMs } from './utils'

export type MonitorRoadmapItem = {
  id: string
  groupId: string
  groupLabel: string
  title: string
  startAt: Date
  endAt: Date
  color: string
}

export type MonitorRoadmapGroup = {
  id: string
  label: string
  items: MonitorRoadmapItem[]
}

const DEFAULT_MINIMUM_DURATION_MS = 60 * 60 * 1000

export const buildMonitorRoadmapGroups = (columns: MonitorBoardColumn[]): MonitorRoadmapGroup[] =>
  columns.map((column) => ({
    id: column.id,
    label: column.label,
    items: column.items.map((entity) => {
      const startAt = new Date(entity.monitor.createdAt)
      const updatedAt = new Date(entity.monitor.updatedAt)
      const minimumDurationMs =
        parseIntervalDurationMs(entity.monitor.providerConfig.monitor.interval) ??
        DEFAULT_MINIMUM_DURATION_MS
      const endAt = new Date(Math.max(updatedAt.getTime(), startAt.getTime() + minimumDurationMs))

      return {
        id: entity.id,
        groupId: column.id,
        groupLabel: column.label,
        title: `${entity.listingLabel} · ${entity.indicatorName}`,
        startAt,
        endAt,
        color: getMonitorStatusColor(entity.primaryStatus),
      } satisfies MonitorRoadmapItem
    }),
  }))
