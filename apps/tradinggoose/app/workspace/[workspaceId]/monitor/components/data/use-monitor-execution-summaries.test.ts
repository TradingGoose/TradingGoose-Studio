import { describe, expect, it } from 'vitest'
import type { WorkflowLog } from '@/lib/logs/types'
import { shouldFetchNextMonitorSummaryPage } from './use-monitor-execution-summaries'

const buildLog = ({
  id,
  monitorId,
  startedAt,
  recordCreatedAt,
}: {
  id: string
  monitorId: string
  startedAt: string
  recordCreatedAt: string
}) =>
  ({
    id,
    startedAt,
    recordCreatedAt,
    outcome: 'success',
    level: 'info',
    executionData: {
      trigger: {
        data: {
          monitor: { id: monitorId },
        },
      },
    },
  }) as unknown as WorkflowLog

describe('shouldFetchNextMonitorSummaryPage', () => {
  it('continues while target monitors are unresolved', () => {
    expect(
      shouldFetchNextMonitorSummaryPage({
        loadedLogs: [
          buildLog({
            id: 'log-1',
            monitorId: 'monitor-1',
            startedAt: '2026-04-23T00:00:00.000Z',
            recordCreatedAt: '2026-04-23T00:00:01.000Z',
          }),
        ],
        summariesByMonitorId: {
          'monitor-1': {
            monitorId: 'monitor-1',
            lastExecutionLogId: 'log-1',
            lastExecutionAt: '2026-04-23T00:00:00.000Z',
            lastOutcome: 'success',
          },
        },
        targetMonitorIds: ['monitor-1', 'monitor-2'],
      })
    ).toBe(true)
  })

  it('continues across a startedAt boundary tie that could affect recordCreatedAt/id winners', () => {
    expect(
      shouldFetchNextMonitorSummaryPage({
        loadedLogs: [
          buildLog({
            id: 'log-1',
            monitorId: 'monitor-1',
            startedAt: '2026-04-23T00:00:00.000Z',
            recordCreatedAt: '2026-04-23T00:00:03.000Z',
          }),
          buildLog({
            id: 'log-boundary',
            monitorId: 'monitor-x',
            startedAt: '2026-04-23T00:00:00.000Z',
            recordCreatedAt: '2026-04-23T00:00:01.000Z',
          }),
        ],
        summariesByMonitorId: {
          'monitor-1': {
            monitorId: 'monitor-1',
            lastExecutionLogId: 'log-1',
            lastExecutionAt: '2026-04-23T00:00:00.000Z',
            lastOutcome: 'success',
          },
        },
        targetMonitorIds: ['monitor-1'],
      })
    ).toBe(true)
  })

  it('stops when all targets are resolved and the page boundary is older', () => {
    expect(
      shouldFetchNextMonitorSummaryPage({
        loadedLogs: [
          buildLog({
            id: 'log-1',
            monitorId: 'monitor-1',
            startedAt: '2026-04-23T00:00:00.000Z',
            recordCreatedAt: '2026-04-23T00:00:03.000Z',
          }),
          buildLog({
            id: 'log-boundary',
            monitorId: 'monitor-x',
            startedAt: '2026-04-22T00:00:00.000Z',
            recordCreatedAt: '2026-04-22T00:00:01.000Z',
          }),
        ],
        summariesByMonitorId: {
          'monitor-1': {
            monitorId: 'monitor-1',
            lastExecutionLogId: 'log-1',
            lastExecutionAt: '2026-04-23T00:00:00.000Z',
            lastOutcome: 'success',
          },
        },
        targetMonitorIds: ['monitor-1'],
      })
    ).toBe(false)
  })
})
