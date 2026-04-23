/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorPage } from './monitor'
import { DEFAULT_MONITOR_VIEW_CONFIG, type MonitorViewRow } from './components/view-config'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const bootstrapMonitorViews = vi.hoisted(() => vi.fn())
const resolveMonitorWorkingConfig = vi.hoisted(() => vi.fn())
const writeMonitorWorkingState = vi.hoisted(() => vi.fn())
const updateMonitorView = vi.hoisted(() => vi.fn())

vi.mock('@/app/workspace/[workspaceId]/monitor/components/api', () => ({
  createMonitorView: vi.fn(),
  listMonitorViews: vi.fn(),
  updateMonitorView,
}))

vi.mock('@/app/workspace/[workspaceId]/monitor/components/view-bootstrap', () => ({
  bootstrapMonitorViews,
}))

vi.mock('@/app/workspace/[workspaceId]/monitor/components/view-preferences', () => ({
  resolveMonitorWorkingConfig,
  writeMonitorWorkingState,
}))

vi.mock('@/app/workspace/[workspaceId]/monitor/components/monitors-view', () => ({
  MonitorsView: ({
    reloadViewState,
    state,
    setters,
  }: {
    reloadViewState: () => Promise<void>
    state: { viewStateMode: string; activeViewId: string | null; viewStateReloading: boolean }
    setters: {
      setViewConfig: (value: unknown) => void
    }
  }) => (
    <div>
      <div data-testid='view-state'>
        {`${state.viewStateMode}:${state.activeViewId ?? 'none'}:${state.viewStateReloading ? 'reloading' : 'idle'}`}
      </div>
      <button
        type='button'
        onClick={() =>
          setters.setViewConfig((current: typeof DEFAULT_MONITOR_VIEW_CONFIG) => ({
            ...current,
            board: {
              groupBy: 'provider',
            },
            filters: {
              ...current.filters,
              workflowId: 'wf-updated',
              providerIds: ['alpaca'],
            },
          }))
        }
      >
        Mutate view config
      </button>
      <button type='button' onClick={() => void reloadViewState()}>
        Reload views
      </button>
    </div>
  ),
}))

const buildViewRow = (overrides: Partial<MonitorViewRow> = {}): MonitorViewRow => ({
  id: 'view-1',
  name: 'Default View',
  sortOrder: 0,
  isActive: true,
  config: DEFAULT_MONITOR_VIEW_CONFIG,
  createdAt: '2026-04-22T00:00:00.000Z',
  updatedAt: '2026-04-22T00:00:00.000Z',
  ...overrides,
})

describe('MonitorPage', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    resolveMonitorWorkingConfig.mockReturnValue(DEFAULT_MONITOR_VIEW_CONFIG)
    writeMonitorWorkingState.mockReturnValue(true)
    updateMonitorView.mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.clearAllMocks()
  })

  it('re-runs bootstrap after an error and passes the latest in-memory config getter', async () => {
    let recoveredConfig: unknown = null
    let resolveRecovery:
      | ((value: {
          viewStateMode: 'server'
          viewRows: MonitorViewRow[]
          activeViewId: string
          viewConfig: typeof DEFAULT_MONITOR_VIEW_CONFIG
          viewsError: null
        }) => void)
      | null = null

    bootstrapMonitorViews
      .mockResolvedValueOnce({
        viewStateMode: 'error',
        viewRows: [],
        activeViewId: null,
        viewConfig: DEFAULT_MONITOR_VIEW_CONFIG,
        viewsError: 'Views offline',
      })
      .mockImplementationOnce(async ({ getLocalWorkingConfig }: { getLocalWorkingConfig: () => unknown }) => {
        recoveredConfig = getLocalWorkingConfig()
        return await new Promise((resolve) => {
          resolveRecovery = resolve
        })
      })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    expect(container.textContent).toContain('error:none:idle')
    expect(bootstrapMonitorViews).toHaveBeenCalledTimes(1)

    const mutateButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Mutate view config')
    )
    const reloadButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Reload views')
    )

    if (!(mutateButton instanceof HTMLButtonElement) || !(reloadButton instanceof HTMLButtonElement)) {
      throw new Error('Expected test controls to render')
    }

    await act(async () => {
      mutateButton.click()
    })

    await act(async () => {
      reloadButton.click()
    })

    expect(bootstrapMonitorViews).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('error:none:reloading')

    await act(async () => {
      resolveRecovery?.({
        viewStateMode: 'server',
        viewRows: [buildViewRow()],
        activeViewId: 'view-1',
        viewConfig: DEFAULT_MONITOR_VIEW_CONFIG,
        viewsError: null,
      })
    })

    expect(container.textContent).toContain('server:view-1:idle')

    expect(recoveredConfig).toMatchObject({
      board: {
        groupBy: 'provider',
      },
      filters: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
        workflowId: 'wf-updated',
        providerIds: ['alpaca'],
      },
    })
  })
})
