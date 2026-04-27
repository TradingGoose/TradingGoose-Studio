import { describe, expect, it } from 'vitest'
import {
  assertStoredMonitorSavedViewConfig,
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
  DEFAULT_MONITOR_SHELL_WORKING_STATE,
  getNextMonitorViewName,
  InvalidMonitorViewConfigRequestError,
  normalizeConfigMonitorViewConfig,
  normalizeExecutionMonitorViewConfig,
  normalizeMonitorShellWorkingState,
  parseMonitorSavedViewConfig,
  UnsupportedMonitorViewConfigError,
} from './view-config'

describe('normalizeExecutionMonitorViewConfig', () => {
  it('falls back to the new execution-workspace defaults for invalid input', () => {
    const normalized = normalizeExecutionMonitorViewConfig({
      layout: 'legacy',
      filterQuery: 'workflow:#wf-1 provider:#alpaca',
      quickFilters: [
        {
          field: 'workflow',
          operator: 'include',
          values: ['', '#wf-1', 'wf-1'],
        },
        {
          field: 'listing',
          operator: 'include',
          values: [
            '',
            JSON.stringify({
              listing_type: 'default',
              listing_id: 'AAPL',
              base_id: 'ignored',
              quote_id: 'ignored',
            }),
            'invalid',
          ],
        },
        { field: 'monitor', operator: 'has', values: ['ignored'] },
        { field: 'assetType', operator: 'no', values: ['ignored'] },
      ],
      sortBy: [{ field: 'invalid', direction: 'desc' }],
      groupBy: 'invalid',
      fieldSums: ['count', 'wat'],
      kanban: {
        columnField: 'provider',
        hiddenColumnIds: ['running', '', 'running'],
        columnLimits: { running: 5, broken: 0 },
        localCardOrder: { running: ['log-1', '', 'log-1'] },
        visibleFieldIds: ['workflow', 'unknown'],
      },
      timeline: {
        markers: { today: false, intervalBoundaries: true },
        zoom: 'day',
        scale: 142,
      },
      timezone: 'America/New_York',
    })

    expect(normalized).toEqual({
      ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
      filterQuery: 'workflow:#wf-1 provider:#alpaca',
      quickFilters: [
        { field: 'workflow', operator: 'include', values: ['wf-1'] },
        {
          field: 'listing',
          operator: 'include',
          values: [
            JSON.stringify({
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            }),
          ],
        },
      ],
      sortBy: [],
      fieldSums: ['count'],
      kanban: {
        ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban,
        columnField: 'provider',
        hiddenColumnIds: ['running'],
        columnLimits: { running: 5 },
        localCardOrder: { running: ['log-1'] },
        visibleFieldIds: ['workflow'],
      },
      timeline: {
        ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.timeline,
        markers: { today: false, intervalBoundaries: true },
        zoom: 'day',
        scale: 140,
      },
      timezone: 'America/New_York',
    })
  })

  it('preserves an explicit unsorted state', () => {
    const normalized = normalizeExecutionMonitorViewConfig({
      ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
      sortBy: [],
    })

    expect(normalized.sortBy).toEqual([])
  })

  it('normalizes config workspace axes, filters, and visible fields', () => {
    const normalized = normalizeConfigMonitorViewConfig({
      ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      filterQuery: ' provider:alpaca ',
      groupBy: 'provider',
      verticalGroupBy: 'provider',
      sliceBy: 'provider',
      quickFilters: [
        { field: 'provider', operator: '=', values: [' alpaca ', 'alpaca'] },
        { field: 'status', operator: '!=', values: ['ACTIVE', 'wat'] },
        { field: 'lastExecutionAt', operator: 'has', values: ['ignored'] },
        { field: 'lastExecutionLogId', operator: '=', values: ['log-1'] },
        { field: 'workflowTarget', operator: 'has', values: [] },
      ],
      sortBy: [
        { field: 'providerId', direction: 'asc' },
        { field: 'providerId', direction: 'desc' },
        { field: 'unknown', direction: 'asc' },
      ],
      fieldSums: ['activeCount', 'count', 'activeCount', 'bad'],
      kanban: {
        localCardOrder: { ' provider ': ['monitor-1', '', 'monitor-1'] },
        visibleFieldIds: ['provider', 'status', 'provider', 'bad'],
      },
    })

    expect(normalized).toEqual({
      ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      filterQuery: 'provider:alpaca',
      groupBy: 'provider',
      verticalGroupBy: null,
      sliceBy: null,
      quickFilters: [
        { field: 'provider', operator: '=', values: ['alpaca'] },
        { field: 'status', operator: '!=', values: ['active'] },
        { field: 'lastExecutionAt', operator: 'has', values: [] },
      ],
      sortBy: [{ field: 'providerId', direction: 'asc' }],
      fieldSums: ['activeCount', 'count'],
      kanban: {
        localCardOrder: { provider: ['monitor-1'] },
        visibleFieldIds: ['provider', 'status'],
      },
    })
  })

  it('parses explicit valid saved-view configs without accepting mode-less data', () => {
    expect(parseMonitorSavedViewConfig(DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG)).toEqual(
      DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG
    )

    expect(() =>
      parseMonitorSavedViewConfig({
        ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        mode: undefined,
      })
    ).toThrow(InvalidMonitorViewConfigRequestError)
  })

  it('rejects invalid explicit request configs instead of coercing to defaults', () => {
    expect(() =>
      parseMonitorSavedViewConfig({
        ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        layout: 'legacy',
      })
    ).toThrow(InvalidMonitorViewConfigRequestError)
  })

  it('rejects invalid explicit stored configs as unsupported data', () => {
    expect(() =>
      assertStoredMonitorSavedViewConfig({
        ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        kanban: {
          ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban,
          columnField: 'invalid',
        },
      })
    ).toThrow(UnsupportedMonitorViewConfigError)
  })

  it('generates same-mode saved-view names without using the other mode', () => {
    const rows = [
      {
        id: 'execution-1',
        name: 'Executions',
        sortOrder: 0,
        isActive: true,
        mode: 'executions' as const,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
      {
        id: 'execution-3',
        name: 'Executions 3',
        sortOrder: 1,
        isActive: false,
        mode: 'executions' as const,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
      {
        id: 'config-1',
        name: 'Config',
        sortOrder: 2,
        isActive: true,
        mode: 'config' as const,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
    ]

    expect(getNextMonitorViewName(rows, 'executions')).toBe('Executions 2')
    expect(getNextMonitorViewName(rows, 'config')).toBe('Config 2')
    expect(
      getNextMonitorViewName(
        rows.filter((row) => row.mode === 'config'),
        'executions'
      )
    ).toBe('Executions')
  })

  it('normalizes strict shell working state without legacy fallback paths', () => {
    expect(normalizeMonitorShellWorkingState(null)).toEqual(DEFAULT_MONITOR_SHELL_WORKING_STATE)
    expect(
      normalizeMonitorShellWorkingState({
        activeMode: 'config',
        activeViewIdsByMode: {
          executions: ' execution-view ',
          config: null,
        },
        executionPanelSizes: [60, 40],
        configPanelSizes: [70, 30],
      })
    ).toEqual({
      activeMode: 'config',
      activeViewIdsByMode: { executions: 'execution-view', config: null },
      executionPanelSizes: [60, 40],
      configPanelSizes: [70, 30],
    })
    expect(
      normalizeMonitorShellWorkingState({
        activeMode: 'config',
        activeViewIdsByMode: {
          executions: ' execution-view ',
          config: null,
          ignored: 'bad',
        },
        executionPanelSizes: [60, 40],
        configPanelSizes: [70, 30],
      })
    ).toEqual(DEFAULT_MONITOR_SHELL_WORKING_STATE)
    expect(
      normalizeMonitorShellWorkingState({
        activeMode: 'config',
        activeViewIdsByMode: {},
        executionPanelSizes: [60, 40],
        configPanelSizes: [70, 30],
        isMonitorsPaneOpen: false,
        innerPanelSizes: [55, 45],
      })
    ).toEqual(DEFAULT_MONITOR_SHELL_WORKING_STATE)
  })
})
