import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MONITOR_VIEW_CONFIG, type MonitorViewRow } from './view-config'
import { bootstrapMonitorViews } from './view-bootstrap'

const baseRow = (overrides: Partial<MonitorViewRow> = {}): MonitorViewRow => ({
  id: 'view-1',
  name: 'Default View',
  sortOrder: 0,
  isActive: true,
  config: DEFAULT_MONITOR_VIEW_CONFIG,
  createdAt: '2026-04-22T00:00:00.000Z',
  updatedAt: '2026-04-22T00:00:00.000Z',
  ...overrides,
})

describe('bootstrapMonitorViews', () => {
  it('treats saved server rows as authoritative over browser-local working state', async () => {
    const localWorkingConfig = {
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      layout: 'roadmap' as const,
      filters: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
        attentionOnly: true,
      },
    }
    const serverRow = baseRow({
      config: {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        filters: {
          ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
          workflowId: 'wf-server',
        },
      },
    })

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      getLocalWorkingConfig: vi.fn().mockReturnValue(localWorkingConfig),
      listMonitorViews: vi.fn().mockResolvedValue([serverRow]),
      createMonitorView: vi.fn(),
    })

    expect(result.viewStateMode).toBe('server')
    expect(result.activeViewId).toBe(serverRow.id)
    expect(result.viewConfig).toEqual(serverRow.config)
    expect(result.viewConfig).not.toEqual(localWorkingConfig)
    expect(result.viewsError).toBeNull()
  })

  it('creates the first saved view from the latest getter value when no rows exist', async () => {
    const initialConfig = DEFAULT_MONITOR_VIEW_CONFIG
    const updatedConfig = {
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      board: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.board,
        groupBy: 'provider' as const,
      },
      filters: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
        workflowId: 'wf-latest',
      },
    }
    let currentConfig = initialConfig
    const createdRow = baseRow({
      id: 'view-created',
      config: updatedConfig,
    })
    const getLocalWorkingConfig = vi.fn(() => currentConfig)
    const listMonitorViews = vi.fn().mockImplementation(async () => {
      currentConfig = updatedConfig
      return []
    })
    const createMonitorView = vi.fn().mockResolvedValue(createdRow)

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      getLocalWorkingConfig,
      listMonitorViews,
      createMonitorView,
    })

    expect(createMonitorView).toHaveBeenCalledWith('workspace-1', {
      name: 'Default View',
      config: updatedConfig,
      makeActive: true,
    })
    expect(result.viewStateMode).toBe('server')
    expect(result.viewRows).toEqual([createdRow])
    expect(result.activeViewId).toBe(createdRow.id)
    expect(result.viewConfig).toEqual(updatedConfig)
    expect(getLocalWorkingConfig).toHaveBeenCalledTimes(1)
  })

  it('returns error mode with the current working config when loading saved views fails', async () => {
    const localWorkingConfig = {
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      filters: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
        attentionOnly: true,
      },
    }

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      getLocalWorkingConfig: vi.fn().mockReturnValue(localWorkingConfig),
      listMonitorViews: vi.fn().mockRejectedValue(new Error('Views offline')),
      createMonitorView: vi.fn(),
    })

    expect(result.viewStateMode).toBe('error')
    expect(result.viewRows).toEqual([])
    expect(result.activeViewId).toBeNull()
    expect(result.viewConfig).toEqual(localWorkingConfig)
    expect(result.viewsError).toBe('Views offline')
  })

  it('returns error mode with the current working config when creating the first view fails', async () => {
    const localWorkingConfig = {
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      filters: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
        workflowId: 'wf-local',
      },
    }

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      getLocalWorkingConfig: vi.fn().mockReturnValue(localWorkingConfig),
      listMonitorViews: vi.fn().mockResolvedValue([]),
      createMonitorView: vi.fn().mockRejectedValue(new Error('Create failed')),
    })

    expect(result.viewStateMode).toBe('error')
    expect(result.viewRows).toEqual([])
    expect(result.activeViewId).toBeNull()
    expect(result.viewConfig).toEqual(localWorkingConfig)
    expect(result.viewsError).toBe('Create failed')
  })
})
