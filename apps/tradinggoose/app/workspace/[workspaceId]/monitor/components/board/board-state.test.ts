import { describe, expect, it } from 'vitest'
import { buildMonitorBoardSections } from './board-state'
import type { MonitorExecutionItem } from '../data/execution-ordering'
import { DEFAULT_MONITOR_VIEW_CONFIG } from '../view/view-config'

const buildExecution = (overrides: Partial<MonitorExecutionItem>): MonitorExecutionItem => ({
  logId: 'log-1',
  workflowId: 'wf-1',
  executionId: 'exec-1',
  startedAt: '2026-04-23T00:00:00.000Z',
  endedAt: '2026-04-23T00:05:00.000Z',
  durationMs: 300000,
  outcome: 'success',
  trigger: 'manual',
  workflowName: 'Workflow One',
  workflowColor: '#3972F6',
  monitorId: 'monitor-1',
  providerId: 'alpaca',
  interval: '1m',
  indicatorId: 'rsi',
  assetType: 'stock',
  listing: null,
  listingLabel: 'AAPL',
  cost: 0.12,
  isOrphaned: false,
  isPartial: false,
  sourceLog: {
    id: 'log-1',
    workflowId: 'wf-1',
    executionId: 'exec-1',
    level: 'info',
    trigger: 'manual',
    startedAt: '2026-04-23T00:00:00.000Z',
    endedAt: '2026-04-23T00:05:00.000Z',
    durationMs: 300000,
    outcome: 'success',
  },
  ...overrides,
})

describe('buildMonitorBoardSections', () => {
  it('returns empty kanban columns instead of an empty-state section when no executions match', () => {
    const sections = buildMonitorBoardSections([], DEFAULT_MONITOR_VIEW_CONFIG)

    expect(sections).toHaveLength(1)
    expect(sections[0]?.label).toBe('All executions')
    expect(sections[0]?.columns.map((column) => column.label)).toEqual([
      'Running',
      'Error',
      'Success',
      'Skipped',
      'Unknown',
    ])
    expect(sections[0]?.columns.every((column) => column.items.length === 0)).toBe(true)
  })

  it('uses groupBy as the section field when sliceBy is not set', () => {
    const sections = buildMonitorBoardSections(
      [
        buildExecution({ logId: 'log-1', workflowId: 'wf-1', workflowName: 'Workflow One' }),
        buildExecution({
          logId: 'log-2',
          workflowId: 'wf-2',
          workflowName: 'Workflow Two',
          outcome: 'error',
        }),
      ],
      {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        groupBy: 'workflow',
        kanban: {
          ...DEFAULT_MONITOR_VIEW_CONFIG.kanban,
          columnField: 'outcome',
        },
      }
    )

    expect(sections.map((section) => section.label)).toEqual(['Workflow One', 'Workflow Two'])
  })

  it('applies local card ordering against rendered column ids when the board is unsorted', () => {
    const sections = buildMonitorBoardSections(
      [
        buildExecution({ logId: 'log-1' }),
        buildExecution({ logId: 'log-2', executionId: 'exec-2' }),
      ],
      {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        sortBy: [],
        groupBy: 'workflow',
        kanban: {
          ...DEFAULT_MONITOR_VIEW_CONFIG.kanban,
          columnField: 'outcome',
          localCardOrder: {
            'wf-1::success': ['log-2', 'log-1'],
          },
        },
      }
    )

    expect(sections[0]?.columns[0]?.items.map((item) => item.logId)).toEqual(['log-2', 'log-1'])
  })

  it('uses the shared execution ordering helper for section ordering', () => {
    const sections = buildMonitorBoardSections(
      [
        buildExecution({ logId: 'log-1', outcome: 'success' }),
        buildExecution({ logId: 'log-2', outcome: 'running' }),
        buildExecution({ logId: 'log-3', outcome: 'error' }),
      ],
      {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        groupBy: 'outcome',
        kanban: {
          ...DEFAULT_MONITOR_VIEW_CONFIG.kanban,
          columnField: 'workflow',
        },
      }
    )

    expect(sections.map((section) => section.label)).toEqual(['Running', 'Error', 'Success'])
  })
})
