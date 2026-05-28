import {
  INDICATOR_MONITOR_PROVIDER,
  PORTFOLIO_MONITOR_PROVIDER,
} from '@/lib/monitors/sources'
import {
  executeIndicatorMonitorJob,
  type IndicatorMonitorExecutionPayload,
  isIndicatorMonitorExecutionPayload,
} from './indicator-monitor-execution'
import {
  executePortfolioMonitorJob,
  isPortfolioMonitorExecutionPayload,
  type PortfolioMonitorExecutionPayload,
} from './portfolio-monitor-execution'

export type MonitorExecutionPayload =
  | IndicatorMonitorExecutionPayload
  | PortfolioMonitorExecutionPayload

export function isMonitorExecutionPayload(value: unknown): value is MonitorExecutionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = (value as { source?: unknown }).source
  if (source === INDICATOR_MONITOR_PROVIDER) return isIndicatorMonitorExecutionPayload(value)
  if (source === PORTFOLIO_MONITOR_PROVIDER) return isPortfolioMonitorExecutionPayload(value)
  return false
}

export async function executeMonitorJob(payload: MonitorExecutionPayload) {
  if (payload.source === INDICATOR_MONITOR_PROVIDER) return executeIndicatorMonitorJob(payload)
  return executePortfolioMonitorJob(payload)
}
