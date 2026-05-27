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
  | ({ source: 'indicator' } & IndicatorMonitorExecutionPayload)
  | ({ source: 'portfolio' } & PortfolioMonitorExecutionPayload)

export function isMonitorExecutionPayload(value: unknown): value is MonitorExecutionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = (value as { source?: unknown }).source
  if (source === 'indicator') return isIndicatorMonitorExecutionPayload(value)
  if (source === 'portfolio') return isPortfolioMonitorExecutionPayload(value)
  return false
}

export async function executeMonitorJob(payload: MonitorExecutionPayload) {
  if (payload.source === 'indicator') return executeIndicatorMonitorJob(payload)
  return executePortfolioMonitorJob(payload)
}
