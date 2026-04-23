import { describe, expect, it } from 'vitest'
import {
  applyMonitorWorkingState,
  DEFAULT_MONITOR_VIEW_CONFIG,
  normalizeMonitorConfigForDataset,
  normalizeMonitorViewConfig,
  resolveMonitorRuntimeConfig,
} from './view-config'

describe('monitor view config', () => {
  it('normalizes invalid values back to the default config shape', () => {
    const normalized = normalizeMonitorViewConfig({
      layout: 'unknown',
      board: { groupBy: 'bad', cardOrder: ['monitor-2', 'monitor-2', '', 1] },
      roadmap: { range: 'weekly', zoom: 300 },
      sort: { field: 'listingLabel', direction: 'up' },
      filters: {
        workflowId: '  ',
        attentionOnly: 1,
        triggerIds: ['indicator_trigger', 'indicator_trigger', '', 1],
        providerIds: ['alpaca', ''],
        intervals: ['1m', '1m'],
        assetTypes: ['STOCK', 'stock'],
      },
      visibleFields: {
        workflow: false,
        updatedAt: false,
      },
      panelSizes: {
        board: [76, 24],
        roadmap: [10, 'bad'],
      },
    })

    expect(normalized).toEqual({
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      roadmap: {
        range: 'monthly',
        zoom: 200,
      },
      board: {
        groupBy: 'status',
        cardOrder: ['monitor-2'],
      },
      sort: {
        field: 'listingLabel',
        direction: 'desc',
      },
      filters: {
        workflowId: null,
        attentionOnly: false,
        triggerIds: ['indicator_trigger'],
        providerIds: ['alpaca'],
        intervals: ['1m'],
        assetTypes: ['stock'],
      },
      visibleFields: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.visibleFields,
        workflow: false,
        updatedAt: false,
      },
      panelSizes: {
        board: [76, 24],
        roadmap: null,
      },
    })
  })

  it('applies working-state overrides without pulling in advanced config', () => {
    const merged = applyMonitorWorkingState(DEFAULT_MONITOR_VIEW_CONFIG, {
      layout: 'roadmap',
      filters: {
        workflowId: 'wf-1',
        attentionOnly: true,
      },
      panelSizes: {
        roadmap: [76, 24],
      },
      board: {
        groupBy: 'provider',
      },
    })

    expect(merged.layout).toBe('roadmap')
    expect(merged.filters.workflowId).toBe('wf-1')
    expect(merged.filters.attentionOnly).toBe(true)
    expect(merged.panelSizes.roadmap).toEqual([76, 24])
    expect(merged.board).toEqual(DEFAULT_MONITOR_VIEW_CONFIG.board)
    expect(merged.roadmap).toEqual(DEFAULT_MONITOR_VIEW_CONFIG.roadmap)
  })

  it('discards malformed panel sizes instead of keeping impossible tuples', () => {
    const normalized = normalizeMonitorViewConfig({
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      panelSizes: {
        board: [1000, 1],
        roadmap: [76, 24],
      },
    })

    expect(normalized.panelSizes.board).toBeNull()
    expect(normalized.panelSizes.roadmap).toEqual([76, 24])
  })

  it('clamps timeline zoom and restores supported Kibo ranges', () => {
    const normalized = normalizeMonitorViewConfig({
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      roadmap: {
        range: 'daily',
        zoom: 10,
      },
    })

    expect(normalized.roadmap.range).toBe('daily')
    expect(normalized.roadmap.zoom).toBe(50)
  })

  it('drops trigger-specific shaping when only one trigger exists in the dataset', () => {
    const normalized = normalizeMonitorConfigForDataset(
      normalizeMonitorViewConfig({
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        board: { ...DEFAULT_MONITOR_VIEW_CONFIG.board, groupBy: 'trigger' },
        filters: { ...DEFAULT_MONITOR_VIEW_CONFIG.filters, triggerIds: ['indicator_trigger'] },
        visibleFields: { ...DEFAULT_MONITOR_VIEW_CONFIG.visibleFields, trigger: true },
      }),
      { hasMultipleTriggers: false }
    )

    expect(normalized.board.groupBy).toBe('status')
    expect(normalized.filters.triggerIds).toEqual([])
    expect(normalized.visibleFields.trigger).toBe(false)
  })

  it('preserves trigger-specific shaping until the monitor dataset is ready', () => {
    const config = resolveMonitorRuntimeConfig(
      {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        board: { ...DEFAULT_MONITOR_VIEW_CONFIG.board, groupBy: 'trigger' },
        filters: { ...DEFAULT_MONITOR_VIEW_CONFIG.filters, triggerIds: ['indicator_trigger'] },
        visibleFields: { ...DEFAULT_MONITOR_VIEW_CONFIG.visibleFields, trigger: true },
      },
      {
        datasetReady: false,
        hasMultipleTriggers: false,
      }
    )

    expect(config.board.groupBy).toBe('trigger')
    expect(config.filters.triggerIds).toEqual(['indicator_trigger'])
    expect(config.visibleFields.trigger).toBe(true)
  })

  it('keeps persisted trigger config intact when runtime falls back for a single-trigger dataset', () => {
    const persistedConfig = normalizeMonitorViewConfig({
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      board: { ...DEFAULT_MONITOR_VIEW_CONFIG.board, groupBy: 'trigger' },
      filters: { ...DEFAULT_MONITOR_VIEW_CONFIG.filters, triggerIds: ['indicator_trigger'] },
      visibleFields: { ...DEFAULT_MONITOR_VIEW_CONFIG.visibleFields, trigger: true },
    })

    const runtimeConfig = resolveMonitorRuntimeConfig(persistedConfig, {
      datasetReady: true,
      hasMultipleTriggers: false,
    })

    expect(persistedConfig.board.groupBy).toBe('trigger')
    expect(persistedConfig.filters.triggerIds).toEqual(['indicator_trigger'])
    expect(persistedConfig.visibleFields.trigger).toBe(true)

    expect(runtimeConfig.board.groupBy).toBe('status')
    expect(runtimeConfig.filters.triggerIds).toEqual([])
    expect(runtimeConfig.visibleFields.trigger).toBe(false)
  })
})
