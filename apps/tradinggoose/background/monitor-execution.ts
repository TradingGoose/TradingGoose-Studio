import { INDICATOR_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import type { IndicatorMonitorExecutionPayload } from './indicator-monitor-execution'
import type { PortfolioMonitorExecutionPayload } from './portfolio-monitor-execution'

export type MonitorExecutionPayload =
  | IndicatorMonitorExecutionPayload
  | PortfolioMonitorExecutionPayload

export async function executeMonitorJob(
  payload: Record<string, unknown> & { executionId: string },
  signal?: AbortSignal
) {
  if (payload.source === INDICATOR_MONITOR_PROVIDER) {
    const { executeIndicatorMonitorJob, isIndicatorMonitorExecutionPayload } = await import(
      './indicator-monitor-execution'
    )
    if (!isIndicatorMonitorExecutionPayload(payload))
      throw new Error('Invalid monitor pending payload')
    return executeIndicatorMonitorJob(payload, signal)
  }
  const { executePortfolioMonitorJob, isPortfolioMonitorExecutionPayload } = await import(
    './portfolio-monitor-execution'
  )
  if (!isPortfolioMonitorExecutionPayload(payload))
    throw new Error('Invalid monitor pending payload')
  return executePortfolioMonitorJob(payload, signal)
}
