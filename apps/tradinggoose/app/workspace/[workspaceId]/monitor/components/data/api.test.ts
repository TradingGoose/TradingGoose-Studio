/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
} from '../view/view-config'
import {
  createMonitorView,
  isUnsupportedMonitorViewDataError,
  listMonitorViews,
  loadIndicatorOptions,
  loadWorkflowTargetOptions,
  MonitorViewRequestError,
  removeMonitorView,
  reorderMonitorViews,
  setActiveMonitorView,
  updateMonitorView,
} from './api'

const buildMonitorViewResponse = (overrides: Record<string, unknown> = {}) => ({
  id: 'view-1',
  name: 'View',
  sortOrder: 0,
  isActive: true,
  mode: 'executions',
  config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides,
})

describe('monitor data api', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'rsi',
              name: 'RSI',
              source: 'default',
              color: '#3972F6',
              inputTitles: ['Length', 'Length', ' '],
              inputMeta: {
                Length: { title: 'Length', type: 'int', defval: 14 },
                Broken: { title: '' },
              },
            },
            {
              id: 'malformed',
              name: 'Malformed',
              source: 'custom',
              color: '',
              inputMeta: [],
            },
          ],
        }),
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads monitor-surface indicator options and preserves valid metadata', async () => {
    const options = await loadIndicatorOptions('workspace 1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/indicators/options?workspaceId=workspace%201&surface=monitor'
    )
    expect(options[0]).toEqual({
      id: 'rsi',
      name: 'RSI',
      source: 'default',
      color: '#3972F6',
      inputTitles: ['Length'],
      inputMeta: {
        Length: { title: 'Length', type: 'int', defval: 14 },
      },
    })
    expect(options[1]).toEqual({
      id: 'malformed',
      name: 'Malformed',
      source: 'custom',
      color: '#3972F6',
    })
  })

  it('loads workflow targets from the workflow list response without deployed fan-out', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'workflow-1',
            name: 'Momentum',
            color: '#111111',
            deployedState: {
              blocks: {
                'trigger-2': {
                  id: 'trigger-2',
                  type: 'indicator_trigger',
                  name: 'RSI Trigger',
                },
                'trigger-1': {
                  id: 'trigger-1',
                  type: 'indicator_trigger',
                  name: 'EMA Trigger',
                },
                'block-1': {
                  id: 'block-1',
                  type: 'agent',
                  name: 'Agent',
                },
              },
            },
          },
          {
            id: 'workflow-2',
            name: 'No Targets',
            color: '#222222',
            deployedState: { blocks: {} },
          },
        ],
      }),
    } as unknown as Response)

    await expect(loadWorkflowTargetOptions('workspace 1')).resolves.toEqual([
      {
        workflowId: 'workflow-1',
        blockId: 'trigger-1',
        workflowName: 'Momentum',
        workflowColor: '#111111',
        isDeployed: true,
        blockName: 'EMA Trigger',
        label: 'Momentum - EMA Trigger',
      },
      {
        workflowId: 'workflow-1',
        blockId: 'trigger-2',
        workflowName: 'Momentum',
        workflowColor: '#111111',
        isDeployed: true,
        blockName: 'RSI Trigger',
        label: 'Momentum - RSI Trigger',
      },
    ])
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/api/workflows?workspaceId=workspace%201')
  })

  it('returns the strict monitor-view row from update responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(
        buildMonitorViewResponse({
          id: 'view-1',
          name: 'Renamed',
        })
      ),
    } as unknown as Response)

    await expect(updateMonitorView('workspace-1', 'view-1', { name: 'Renamed' })).resolves.toEqual(
      expect.objectContaining({
        id: 'view-1',
        name: 'Renamed',
        mode: 'executions',
      })
    )
  })

  it('strictly parses monitor-view rows from list, create, and update responses', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            buildMonitorViewResponse(),
            buildMonitorViewResponse({
              id: 'config-view',
              mode: 'config',
              config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
            }),
          ],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(buildMonitorViewResponse({ id: 'created-view' })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(buildMonitorViewResponse({ id: 'updated-view' })),
      } as unknown as Response)

    const rows = await listMonitorViews('workspace-1')
    const created = await createMonitorView('workspace-1', {
      name: 'Execution',
      config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
    })
    const updated = await updateMonitorView('workspace-1', 'view-1', { name: 'Next' })

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.mode === row.config.mode)).toBe(true)
    expect(created.mode).toBe(created.config.mode)
    expect(updated.mode).toBe(updated.config.mode)
  })

  it('throws when update responses do not contain a strict monitor-view row', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as Response)

    await expect(updateMonitorView('workspace-1', 'view-1', { name: 'Renamed' })).rejects.toThrow(
      'Invalid monitor view response'
    )
  })

  it('rejects list, create, and update rows with mismatched runtime and config modes', async () => {
    const mismatchedRow = buildMonitorViewResponse({
      mode: 'executions',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [mismatchedRow] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mismatchedRow),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mismatchedRow),
      } as unknown as Response)

    await expect(listMonitorViews('workspace-1')).rejects.toThrow('Invalid monitor view response')
    await expect(
      createMonitorView('workspace-1', {
        name: 'Execution',
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
      })
    ).rejects.toThrow('Invalid monitor view response')
    await expect(updateMonitorView('workspace-1', 'view-1', { name: 'Next' })).rejects.toThrow(
      'Invalid monitor view response'
    )
  })

  it('accepts exact success responses for void monitor-view mutations', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      } as unknown as Response)

    await expect(setActiveMonitorView('workspace-1', 'view-1')).resolves.toBeUndefined()
    await expect(
      reorderMonitorViews('workspace-1', { mode: 'executions', viewOrder: ['view-1'] })
    ).resolves.toBeUndefined()
    await expect(removeMonitorView('workspace-1', 'view-1')).resolves.toBeUndefined()
  })

  it('throws when void monitor-view mutations do not return exact success responses', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: null }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: false }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response)

    await expect(setActiveMonitorView('workspace-1', 'view-1')).rejects.toThrow(
      'Invalid monitor view success response'
    )
    await expect(
      reorderMonitorViews('workspace-1', { mode: 'executions', viewOrder: ['view-1'] })
    ).rejects.toThrow('Invalid monitor view success response')
    await expect(removeMonitorView('workspace-1', 'view-1')).rejects.toThrow(
      'Invalid monitor view success response'
    )
  })

  it('surfaces unsupported monitor-view data errors from every monitor-view helper', async () => {
    const unsupportedResponse = () =>
      ({
        ok: false,
        status: 409,
        json: vi.fn().mockResolvedValue({ error: 'Unsupported monitor view data' }),
      }) as unknown as Response
    vi.mocked(fetch)
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(unsupportedResponse())

    const expectUnsupportedError = async (action: () => Promise<unknown>) => {
      let caught: unknown
      try {
        await action()
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(MonitorViewRequestError)
      expect(caught).toMatchObject({
        message: 'Unsupported monitor view data',
        status: 409,
      })
      expect(isUnsupportedMonitorViewDataError(caught)).toBe(true)
    }

    await expectUnsupportedError(() => listMonitorViews('workspace-1'))
    await expectUnsupportedError(() =>
      createMonitorView('workspace-1', {
        name: 'Execution',
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
      })
    )
    await expectUnsupportedError(() => setActiveMonitorView('workspace-1', 'view-1'))
    await expectUnsupportedError(() =>
      reorderMonitorViews('workspace-1', { mode: 'executions', viewOrder: ['view-1'] })
    )
    await expectUnsupportedError(() => updateMonitorView('workspace-1', 'view-1', { name: 'Next' }))
    await expectUnsupportedError(() => removeMonitorView('workspace-1', 'view-1'))
  })
})
