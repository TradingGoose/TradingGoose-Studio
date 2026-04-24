import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MONITOR_VIEW_CONFIG, type MonitorViewRow } from './view-config'
import { bootstrapMonitorViews } from './view-bootstrap'

const buildRow = (overrides: Partial<MonitorViewRow> = {}): MonitorViewRow => ({
  id: 'view-1',
  name: 'Default View',
  sortOrder: 0,
  isActive: true,
  config: DEFAULT_MONITOR_VIEW_CONFIG,
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides,
})

describe('bootstrapMonitorViews', () => {
  it('returns the active view config from server rows', async () => {
    const savedRow = buildRow()

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      listMonitorViews: vi.fn().mockResolvedValue([savedRow]),
      createMonitorView: vi.fn(),
    })

    expect(result.activeViewId).toBe(savedRow.id)
    expect(result.viewConfig).toEqual(savedRow.config)
  })

  it('creates a default saved view when none exist', async () => {
    const createdRow = buildRow({ id: 'view-created' })
    const createMonitorView = vi.fn().mockResolvedValue(createdRow)

    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      listMonitorViews: vi.fn().mockResolvedValue([]),
      createMonitorView,
    })

    expect(createMonitorView).toHaveBeenCalledWith('workspace-1', {
      name: 'Default View',
      config: DEFAULT_MONITOR_VIEW_CONFIG,
      makeActive: true,
    })
    expect(result.viewRows).toEqual([createdRow])
    expect(result.viewConfig).toEqual(DEFAULT_MONITOR_VIEW_CONFIG)
  })

  it('returns the normalized default config when the server bootstrap fails', async () => {
    const result = await bootstrapMonitorViews({
      workspaceId: 'workspace-1',
      listMonitorViews: vi.fn().mockRejectedValue(new Error('boom')),
      createMonitorView: vi.fn(),
    })

    expect(result).toEqual({
      viewStateMode: 'error',
      viewRows: [],
      activeViewId: null,
      viewConfig: DEFAULT_MONITOR_VIEW_CONFIG,
      viewsError: 'boom',
    })
  })
})
