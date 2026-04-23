import { BrowserStorage } from '@/lib/browser-storage'
import {
  applyMonitorWorkingState,
  DEFAULT_MONITOR_VIEW_CONFIG,
  getMonitorWorkingStateFromConfig,
  type MonitorViewConfig,
  type MonitorWorkingState,
} from './view-config'

const MONITOR_WORKING_STATE_PREFIX = 'monitor-working-state'

export const getMonitorWorkingStateKey = (workspaceId: string, userId: string) =>
  `${MONITOR_WORKING_STATE_PREFIX}:${workspaceId}:${userId}`

export const readMonitorWorkingState = (
  workspaceId: string,
  userId: string
): MonitorWorkingState | null => {
  if (!workspaceId || !userId) return null

  return BrowserStorage.getItem<MonitorWorkingState | null>(
    getMonitorWorkingStateKey(workspaceId, userId),
    null
  )
}

export const resolveMonitorWorkingConfig = (workspaceId: string, userId: string) =>
  applyMonitorWorkingState(
    DEFAULT_MONITOR_VIEW_CONFIG,
    readMonitorWorkingState(workspaceId, userId)
  )

export const writeMonitorWorkingState = (
  workspaceId: string,
  userId: string,
  config: MonitorViewConfig
) => {
  if (!workspaceId || !userId) return false

  return BrowserStorage.setItem(
    getMonitorWorkingStateKey(workspaceId, userId),
    getMonitorWorkingStateFromConfig(config)
  )
}
