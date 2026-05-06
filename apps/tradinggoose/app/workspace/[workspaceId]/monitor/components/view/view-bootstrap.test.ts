import { describe, expect, it, vi } from 'vitest'
import { MonitorViewRequestError } from '../data/api'
import { bootstrapMonitorViews } from './view-bootstrap'
import {
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
  type MonitorViewRow,
} from './view-config'

const buildRow = (overrides: Partial<MonitorViewRow> = {}): MonitorViewRow => ({
  id: 'view-1',
  name: 'Executions',
  sortOrder: 0,
  isActive: true,
  mode: 'executions',
  config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides,
})

describe('bootstrapMonitorViews', () => {
  it('returns the active execution and config view state from server rows', async () => {
    const executionRow = buildRow()
    const configRow = buildRow({
      id: 'config-view',
      name: 'Config',
      sortOrder: 1,
      mode: 'config',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
    })

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      preferredActiveMode: 'config',
      preferredActiveViewIdsByMode: { executions: executionRow.id, config: configRow.id },
      listMonitorViews: vi.fn().mockResolvedValue([executionRow, configRow]),
      createMonitorView: vi.fn(),
    })

    expect(result.viewStateMode).toBe('server')
    expect(result.activeViewIdsByMode).toEqual({
      executions: executionRow.id,
      config: configRow.id,
    })
    expect(result.configsByMode?.executions).toEqual(executionRow.config)
    expect(result.configsByMode?.config).toEqual(configRow.config)
    expect(result.initialMode).toBe('config')
  })

  it('creates default saved views for missing modes', async () => {
    const executionRow = buildRow({ id: 'execution-created' })
    const configRow = buildRow({
      id: 'config-created',
      name: 'Config',
      sortOrder: 1,
      mode: 'config',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
    })
    const createMonitorView = vi
      .fn()
      .mockResolvedValueOnce(executionRow)
      .mockResolvedValueOnce(configRow)

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      preferredActiveMode: 'executions',
      preferredActiveViewIdsByMode: {},
      listMonitorViews: vi.fn().mockResolvedValue([]),
      createMonitorView,
    })

    expect(createMonitorView).toHaveBeenNthCalledWith(1, 'workspace-1', {
      name: 'Executions',
      config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
      makeActive: true,
    })
    expect(createMonitorView).toHaveBeenNthCalledWith(2, 'workspace-1', {
      name: 'Config',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      makeActive: true,
    })
    expect(result.viewRows).toEqual([executionRow, configRow])
    expect(result.activeViewIdsByMode).toEqual({
      executions: executionRow.id,
      config: configRow.id,
    })
  })

  it('continues default view creation by mode and returns partial-error when one mode fails', async () => {
    const configRow = buildRow({
      id: 'config-created',
      name: 'Config',
      sortOrder: 1,
      mode: 'config',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
    })
    const createMonitorView = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unable to create executions'))
      .mockResolvedValueOnce(configRow)

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      preferredActiveMode: 'executions',
      preferredActiveViewIdsByMode: {},
      listMonitorViews: vi.fn().mockResolvedValue([]),
      createMonitorView,
    })

    expect(createMonitorView).toHaveBeenNthCalledWith(1, 'workspace-1', {
      name: 'Executions',
      config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
      makeActive: true,
    })
    expect(createMonitorView).toHaveBeenNthCalledWith(2, 'workspace-1', {
      name: 'Config',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      makeActive: true,
    })
    expect(result.viewStateMode).toBe('partial-error')
    expect(result.rowStateByMode).toEqual({ executions: 'error', config: 'server' })
    expect(result.renderableModes).toEqual(['config'])
    expect(result.initialMode).toBe('config')
    expect(result.activeViewIdsByMode).toEqual({ config: 'config-created' })
    expect(result.viewsError).toBe('Unable to create executions')
  })

  it('preserves unsupported-data 409 messages during per-mode default creation', async () => {
    const executionRow = buildRow({ id: 'execution-created' })
    const createMonitorView = vi
      .fn()
      .mockResolvedValueOnce(executionRow)
      .mockRejectedValueOnce(new MonitorViewRequestError('Unsupported monitor view data.', 409))

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      preferredActiveMode: 'config',
      preferredActiveViewIdsByMode: {},
      listMonitorViews: vi.fn().mockResolvedValue([]),
      createMonitorView,
    })

    expect(result.viewStateMode).toBe('partial-error')
    expect(result.rowStateByMode).toEqual({ executions: 'server', config: 'error' })
    expect(result.errorsByMode).toEqual({ config: 'Unsupported monitor view data.' })
    expect(result.initialMode).toBe('executions')
  })

  it('returns mode-aware default configs when server bootstrap fails', async () => {
    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      preferredActiveMode: 'executions',
      preferredActiveViewIdsByMode: {},
      listMonitorViews: vi.fn().mockRejectedValue(new Error('boom')),
      createMonitorView: vi.fn(),
    })

    expect(result).toEqual(
      expect.objectContaining({
        viewStateMode: 'error',
        viewRows: [],
        configsByMode: {
          executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        },
        viewsError: 'boom',
      })
    )
  })

  it('does not mask active rows whose runtime mode differs from their config mode', async () => {
    const mismatchedRow = buildRow({
      mode: 'executions',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
    } as Partial<MonitorViewRow>)
    const configRow = buildRow({
      id: 'config-view',
      name: 'Config',
      sortOrder: 1,
      mode: 'config',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
    })

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      preferredActiveMode: 'executions',
      preferredActiveViewIdsByMode: {},
      listMonitorViews: vi.fn().mockResolvedValue([mismatchedRow, configRow]),
      createMonitorView: vi.fn(),
    })

    expect(result.viewStateMode).toBe('partial-error')
    expect(result.rowStateByMode).toEqual({ executions: 'error', config: 'server' })
    expect(result.errorsByMode).toEqual({ executions: 'Invalid monitor view response' })
    expect(result.activeViewIdsByMode).toEqual({ config: 'config-view' })
    expect(result.configsByMode.executions).toEqual(DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG)
  })
})
