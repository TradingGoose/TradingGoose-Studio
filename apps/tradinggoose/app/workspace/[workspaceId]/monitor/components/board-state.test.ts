import { describe, expect, it } from 'vitest'
import {
  buildMonitorBoardColumns,
  buildMonitorEntities,
  filterMonitorEntities,
  getMonitorFilterOptions,
  mergeVisibleStatusBoardCardOrder,
  shouldEnableTriggerControls,
} from './board-state'
import { DEFAULT_MONITOR_VIEW_CONFIG } from './view-config'
import type { IndicatorMonitorRecord, IndicatorOption, WorkflowTargetOption } from './types'

const indicators: IndicatorOption[] = [
  { id: 'rsi', name: 'RSI', source: 'default', color: '#ff6600' },
]

const workflows = [
  { workflowId: 'wf-1', workflowName: 'Momentum', workflowColor: '#3972F6' },
  { workflowId: 'wf-2', workflowName: 'Mean Reversion', workflowColor: '#8B5CF6' },
]

const workflowTargets: WorkflowTargetOption[] = [
  {
    workflowId: 'wf-1',
    blockId: 'trigger-a',
    workflowName: 'Momentum',
    workflowColor: '#3972F6',
    isDeployed: true,
    blockName: 'Entry Trigger',
    label: 'Momentum - Entry Trigger',
  },
  {
    workflowId: 'wf-1',
    blockId: 'trigger-b',
    workflowName: 'Momentum',
    workflowColor: '#3972F6',
    isDeployed: true,
    blockName: 'Exit Trigger',
    label: 'Momentum - Exit Trigger',
  },
]

const providers = [{ id: 'alpaca', name: 'Alpaca' }]

const baseMonitor = (overrides: Partial<IndicatorMonitorRecord>): IndicatorMonitorRecord => ({
  monitorId: 'monitor-1',
  workflowId: 'wf-1',
  blockId: 'trigger-a',
  isActive: true,
  providerConfig: {
    triggerId: 'indicator_trigger',
    version: 1,
    monitor: {
      providerId: 'alpaca',
      interval: '1m',
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      indicatorId: 'rsi',
      auth: {
        hasEncryptedSecrets: true,
        encryptedSecretFieldIds: ['apiKey', 'secretKey'],
      },
    },
  },
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-22T00:00:00.000Z',
  ...overrides,
})

describe('board state', () => {
  it('derives primary status with the locked precedence rules', () => {
    const entities = buildMonitorEntities({
      monitors: [
        baseMonitor({
          monitorId: 'missing-auth',
          workflowId: 'wf-2',
          blockId: 'missing-trigger',
          providerConfig: {
            triggerId: 'indicator_trigger',
            version: 1,
            monitor: {
              ...baseMonitor({}).providerConfig.monitor,
              auth: {
                hasEncryptedSecrets: false,
              },
            },
          },
        }),
        baseMonitor({
          monitorId: 'needs-deploy',
          workflowId: 'wf-2',
          blockId: 'missing-trigger',
        }),
        baseMonitor({
          monitorId: 'paused',
          isActive: false,
        }),
        baseMonitor({
          monitorId: 'running',
        }),
      ],
      workflowTargets,
      workflows,
      indicators,
      providers,
    })

    expect(entities.find((entity) => entity.id === 'missing-auth')?.primaryStatus).toBe(
      'missing_auth'
    )
    expect(entities.find((entity) => entity.id === 'missing-auth')?.secondaryStatuses).toEqual([
      'needs_deploy',
    ])
    expect(entities.find((entity) => entity.id === 'needs-deploy')?.primaryStatus).toBe(
      'needs_deploy'
    )
    expect(entities.find((entity) => entity.id === 'paused')?.primaryStatus).toBe('paused')
    expect(entities.find((entity) => entity.id === 'running')?.primaryStatus).toBe('running')
  })

  it('filters attention-only monitors and preserves the canonical status columns', () => {
    const entities = buildMonitorEntities({
      monitors: [
        baseMonitor({ monitorId: 'running' }),
        baseMonitor({ monitorId: 'paused', isActive: false }),
        baseMonitor({
          monitorId: 'needs-deploy',
          workflowId: 'wf-2',
          blockId: 'missing-trigger',
        }),
      ],
      workflowTargets,
      workflows,
      indicators,
      providers,
    })

    const filtered = filterMonitorEntities(
      entities,
      {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        filters: {
          ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
          attentionOnly: true,
        },
      },
      ''
    )

    expect(filtered.map((entity) => entity.id)).toEqual(['needs-deploy'])

    const columns = buildMonitorBoardColumns(filtered, {
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      filters: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
        attentionOnly: true,
      },
    })

    expect(columns.map((column) => column.id)).toEqual(['missing_auth', 'needs_deploy'])
    expect(columns[0]?.items).toEqual([])
    expect(columns[1]?.items.map((item) => item.id)).toEqual(['needs-deploy'])
  })

  it('keeps the default updatedAt sort newest-first within status lanes', () => {
    const entities = buildMonitorEntities({
      monitors: [
        baseMonitor({
          monitorId: 'older',
          updatedAt: '2026-04-20T00:00:00.000Z',
        }),
        baseMonitor({
          monitorId: 'newer',
          updatedAt: '2026-04-22T00:00:00.000Z',
        }),
      ],
      workflowTargets,
      workflows,
      indicators,
      providers,
    })

    const columns = buildMonitorBoardColumns(entities, DEFAULT_MONITOR_VIEW_CONFIG)

    expect(columns.find((column) => column.id === 'running')?.items.map((item) => item.id)).toEqual(
      ['newer', 'older']
    )
  })

  it('respects the saved status-board card order before the default sort order', () => {
    const entities = buildMonitorEntities({
      monitors: [
        baseMonitor({
          monitorId: 'older',
          updatedAt: '2026-04-20T00:00:00.000Z',
        }),
        baseMonitor({
          monitorId: 'newer',
          updatedAt: '2026-04-22T00:00:00.000Z',
        }),
      ],
      workflowTargets,
      workflows,
      indicators,
      providers,
    })

    const columns = buildMonitorBoardColumns(entities, {
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      board: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.board,
        cardOrder: ['older', 'newer'],
      },
    })

    expect(columns.find((column) => column.id === 'running')?.items.map((item) => item.id)).toEqual(
      ['older', 'newer']
    )
  })

  it('keeps listing groups newest-first even when listing columns are sorted descending', () => {
    const entities = buildMonitorEntities({
      monitors: [
        baseMonitor({
          monitorId: 'aapl-older',
          updatedAt: '2026-04-20T00:00:00.000Z',
          providerConfig: {
            triggerId: 'indicator_trigger',
            version: 1,
            monitor: {
              ...baseMonitor({}).providerConfig.monitor,
              listing: {
                listing_id: 'ZZZ',
                base_id: '',
                quote_id: '',
                listing_type: 'default',
                base: 'Apple',
              } as IndicatorMonitorRecord['providerConfig']['monitor']['listing'],
            },
          },
        }),
        baseMonitor({
          monitorId: 'aapl-newer',
          updatedAt: '2026-04-22T00:00:00.000Z',
          providerConfig: {
            triggerId: 'indicator_trigger',
            version: 1,
            monitor: {
              ...baseMonitor({}).providerConfig.monitor,
              listing: {
                listing_id: 'ZZZ',
                base_id: '',
                quote_id: '',
                listing_type: 'default',
                base: 'Apple',
              } as IndicatorMonitorRecord['providerConfig']['monitor']['listing'],
            },
          },
        }),
        baseMonitor({
          monitorId: 'tsla',
          updatedAt: '2026-04-21T00:00:00.000Z',
          providerConfig: {
            triggerId: 'indicator_trigger',
            version: 1,
            monitor: {
              ...baseMonitor({}).providerConfig.monitor,
              listing: {
                listing_id: 'AAA',
                base_id: '',
                quote_id: '',
                listing_type: 'default',
                base: 'Tesla',
              } as IndicatorMonitorRecord['providerConfig']['monitor']['listing'],
            },
          },
        }),
      ],
      workflowTargets,
      workflows,
      indicators,
      providers,
    })

    const columns = buildMonitorBoardColumns(entities, {
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      board: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.board,
        groupBy: 'listing',
      },
      sort: {
        field: 'listingLabel',
        direction: 'desc',
      },
    })

    expect(columns.map((column) => column.label)).toEqual(['Tesla', 'Apple'])
    expect(columns[1]?.items.map((item) => item.id)).toEqual(['aapl-newer', 'aapl-older'])
  })

  it('uses the registry trigger label and collapses to a single trigger option with the current monitor model', () => {
    const entities = buildMonitorEntities({
      monitors: [
        baseMonitor({
          monitorId: 'entry-newer',
          updatedAt: '2026-04-22T00:00:00.000Z',
        }),
        baseMonitor({
          monitorId: 'entry-older',
          updatedAt: '2026-04-20T00:00:00.000Z',
        }),
        baseMonitor({
          monitorId: 'exit-monitor',
          blockId: 'trigger-b',
          updatedAt: '2026-04-21T00:00:00.000Z',
        }),
      ],
      workflowTargets,
      workflows,
      indicators,
      providers,
    })

    expect(shouldEnableTriggerControls(entities)).toBe(false)
    expect(
      entities.map((entity) => ({
        id: entity.id,
        triggerId: entity.triggerId,
        triggerName: entity.triggerName,
      }))
    ).toEqual([
      { id: 'entry-newer', triggerId: 'indicator_trigger', triggerName: 'Indicator Trigger' },
      { id: 'entry-older', triggerId: 'indicator_trigger', triggerName: 'Indicator Trigger' },
      { id: 'exit-monitor', triggerId: 'indicator_trigger', triggerName: 'Indicator Trigger' },
    ])

    expect(getMonitorFilterOptions(entities).triggers).toEqual([
      { value: 'indicator_trigger', label: 'Indicator Trigger' },
    ])

    const filtered = filterMonitorEntities(
      entities,
      {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        filters: {
          ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
          triggerIds: ['indicator_trigger'],
        },
      },
      ''
    )

    expect(filtered.map((entity) => entity.id)).toEqual([
      'entry-newer',
      'entry-older',
      'exit-monitor',
    ])

    const columns = buildMonitorBoardColumns(entities, {
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      board: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.board,
        groupBy: 'trigger',
      },
    })

    expect(columns.map((column) => ({ id: column.id, label: column.label }))).toEqual([
      { id: 'indicator_trigger', label: 'Indicator Trigger' },
    ])
    expect(columns[0]?.items.map((item) => item.id)).toEqual([
      'entry-newer',
      'exit-monitor',
      'entry-older',
    ])
  })

  it('merges visible status-board reorders back into the full saved order', () => {
    expect(
      mergeVisibleStatusBoardCardOrder(
        ['running-a', 'paused-b', 'running-c', 'paused-d'],
        ['running-c', 'running-a']
      )
    ).toEqual(['running-c', 'paused-b', 'running-a', 'paused-d'])
  })
})
