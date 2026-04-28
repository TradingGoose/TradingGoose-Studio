/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createIndicatorMonitor,
  createMonitorView,
  deleteIndicatorMonitor,
  loadIndicatorOptions,
  loadMonitors,
  loadWorkflowOptions,
  loadWorkflowTargetOptions,
  removeMonitorView,
  setActiveMonitorView,
  updateIndicatorMonitor,
  updateMonitorView,
} from '@/app/workspace/[workspaceId]/monitor/components/data/api'
import { bootstrapMonitorViews } from '@/app/workspace/[workspaceId]/monitor/components/view/view-bootstrap'
import {
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
  type MonitorViewRow,
} from './components/view/view-config'
import { MonitorPage } from './monitor'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

vi.mock('@/global-navbar', () => ({
  GlobalNavbarHeader: ({
    left,
    center,
    right,
  }: {
    left?: ReactNode
    center?: ReactNode
    right?: ReactNode
  }) => (
    <div>
      <div>{left}</div>
      <div>{center}</div>
      <div>{right}</div>
    </div>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/monitor',
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/layout-tabs', () => ({
  LayoutTabs: ({
    layouts,
    isBusy = false,
    onCreate,
    onSelect,
    onRequestRename,
    onDelete,
  }: {
    layouts: Array<{ id: string; name: string; isActive: boolean }>
    isBusy?: boolean
    onCreate: () => void
    onSelect: (layoutId: string) => void
    onRequestRename?: (layoutId: string) => void
    onDelete?: (layoutId: string) => void
  }) => (
    <div>
      <button type='button' disabled={isBusy} onClick={onCreate}>
        Create view
      </button>
      {layouts.map((layout) => (
        <div key={layout.id}>
          <button
            type='button'
            data-active={layout.isActive ? 'true' : 'false'}
            disabled={isBusy}
            onClick={() => onSelect(layout.id)}
          >
            {layout.name}
          </button>
          {layout.isActive && onRequestRename ? (
            <button type='button' disabled={isBusy} onClick={() => onRequestRename(layout.id)}>
              Rename {layout.name}
            </button>
          ) : null}
          {onDelete ? (
            <button type='button' disabled={isBusy} onClick={() => onDelete(layout.id)}>
              Delete {layout.name}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/logs-toolbar', () => ({
  AutocompleteSearch: ({
    value,
    workflowsData = [],
    foldersData = [],
    externalClauses = [],
    onRemoveExternalClause,
  }: {
    value: string
    workflowsData?: Array<{ id: string; name: string }>
    foldersData?: Array<{ id: string; name: string }>
    externalClauses?: Array<{ id: string; raw: string }>
    onRemoveExternalClause?: (clause: { id: string; raw: string }) => void
  }) => (
    <div>
      <div data-testid='autocomplete-value'>{value}</div>
      <div data-testid='autocomplete-workflow-count'>{workflowsData.length}</div>
      <div data-testid='autocomplete-folder-count'>{foldersData.length}</div>
      <div data-testid='autocomplete-external'>
        {externalClauses.map((clause) => clause.raw).join('|')}
      </div>
      {externalClauses.map((clause) => (
        <button key={clause.id} type='button' onClick={() => onRemoveExternalClause?.(clause)}>
          Remove {clause.raw}
        </button>
      ))}
    </div>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/monitor/components/workspace/monitor-config-workspace',
  () => ({
    MonitorConfigWorkspace: (props: any) => (
      <div>
        <div data-testid='config-create-request-id'>{props.createMonitorRequestId}</div>
        <div data-testid='config-views-error'>{props.viewsError ?? 'none'}</div>
        <button
          type='button'
          onClick={() =>
            props.onUpdateViewConfig((current: typeof DEFAULT_CONFIG_MONITOR_VIEW_CONFIG) => ({
              ...current,
              filterQuery: 'provider:#alpaca',
            }))
          }
        >
          Change config view
        </button>
        <button
          type='button'
          onClick={() =>
            props.monitorActions.createMonitor({
              workspaceId: 'workspace-1',
              workflowId: 'workflow-1',
              blockId: 'block-1',
              providerId: 'alpaca',
              interval: '1m',
              indicatorId: 'rsi',
              listing: { listing_type: 'default', listing_id: 'AAPL' },
              auth: { secrets: {} },
              isActive: true,
            })
          }
        >
          Create monitor
        </button>
        <button
          type='button'
          onClick={() =>
            props.monitorActions.toggleMonitorState(
              {
                monitorId: 'monitor-1',
                isActive: true,
              },
              false
            )
          }
        >
          Toggle monitor
        </button>
        <button type='button' onClick={() => props.monitorActions.deleteMonitor('monitor-1')}>
          Delete monitor
        </button>
      </div>
    ),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/monitor/components/workspace/monitor-execution-workspace',
  () => ({
    MonitorExecutionWorkspace: (props: any) => (
      <div>
        <div data-testid='selected-execution'>{props.selectedExecutionLogId ?? 'none'}</div>
        <div data-testid='views-error'>{props.viewsError ?? 'none'}</div>
        <button
          type='button'
          onClick={() =>
            props.onUpdateViewConfig((current: typeof DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG) => ({
              ...current,
              filterQuery: 'status:success',
            }))
          }
        >
          Change view
        </button>
        <button type='button' onClick={() => props.onSelectExecution('log-1')}>
          Select execution
        </button>
        <button type='button' onClick={() => props.onToggleQuickFilter('provider', 'alpaca')}>
          Toggle provider filter
        </button>
      </div>
    ),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/monitor/components/data/use-monitor-workspace-logs',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/app/workspace/[workspaceId]/monitor/components/data/use-monitor-workspace-logs')
      >()

    return {
      ...actual,
      useMonitorWorkspaceLogs: () => ({
        executionItems: [
          {
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
            sourceLog: { id: 'log-1' },
          },
        ],
        orderedVisibleLogIds: ['log-1'],
        isSelectionResolved: true,
        isLoading: false,
        isFetching: false,
        error: null,
        refresh: vi.fn(),
      }),
    }
  }
)

vi.mock('@/hooks/queries/logs', () => ({
  buildLogsRequestParams: (workspaceId: string, filters: any, options?: any) => {
    const params = new URLSearchParams({ workspaceId })
    if (options?.includePagination !== false) {
      params.set('limit', String(filters.limit ?? 100))
      params.set('offset', '0')
    }
    if (options?.includeDetails !== false) {
      params.set('details', filters.details ?? 'basic')
    }
    if (filters.triggerSource) {
      params.set('triggerSource', filters.triggerSource)
    }
    return params.toString()
  },
  useLogDetail: () => ({ data: null, isLoading: false, error: null }),
}))

vi.mock('@/app/workspace/[workspaceId]/monitor/components/data/api', () => ({
  createMonitorView: vi.fn(),
  createIndicatorMonitor: vi.fn(),
  deleteIndicatorMonitor: vi.fn(),
  listMonitorViews: vi.fn(),
  loadIndicatorOptions: vi.fn().mockResolvedValue([]),
  loadMonitors: vi.fn().mockResolvedValue([]),
  loadWorkflowOptions: vi.fn().mockResolvedValue([]),
  loadWorkflowTargetOptions: vi.fn().mockResolvedValue([]),
  removeMonitorView: vi.fn(),
  reorderMonitorViews: vi.fn(),
  setActiveMonitorView: vi.fn(),
  updateIndicatorMonitor: vi.fn(),
  updateMonitorView: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/monitor/components/view/view-bootstrap', () => ({
  bootstrapMonitorViews: vi.fn(),
}))

const mockedBootstrapMonitorViews = vi.mocked(bootstrapMonitorViews)
const mockedCreateIndicatorMonitor = vi.mocked(createIndicatorMonitor)
const mockedCreateMonitorView = vi.mocked(createMonitorView)
const mockedDeleteIndicatorMonitor = vi.mocked(deleteIndicatorMonitor)
const mockedLoadIndicatorOptions = vi.mocked(loadIndicatorOptions)
const mockedLoadMonitors = vi.mocked(loadMonitors)
const mockedLoadWorkflowOptions = vi.mocked(loadWorkflowOptions)
const mockedLoadWorkflowTargetOptions = vi.mocked(loadWorkflowTargetOptions)
const mockedUpdateMonitorView = vi.mocked(updateMonitorView)
const mockedUpdateIndicatorMonitor = vi.mocked(updateIndicatorMonitor)
const mockedRemoveMonitorView = vi.mocked(removeMonitorView)
const mockedSetActiveMonitorView = vi.mocked(setActiveMonitorView)

const buildViewRow = ({
  id,
  name,
  isActive,
  config = DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
}: {
  id: string
  name: string
  isActive: boolean
  config?: MonitorViewRow['config']
}): MonitorViewRow => ({
  id,
  name,
  sortOrder: isActive ? 0 : 1,
  isActive,
  mode: config.mode,
  config,
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
})

const buildMonitorRow = (monitorId: string) => ({
  monitorId,
  workflowId: 'workflow-1',
  blockId: 'block-1',
  isActive: true,
  providerConfig: {
    triggerId: 'indicator_trigger' as const,
    version: 1 as const,
    monitor: {
      providerId: 'alpaca',
      interval: '1m',
      listing: { listing_type: 'default' as const, listing_id: 'AAPL' },
      indicatorId: 'rsi',
    },
  },
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
})

describe('MonitorPage', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: 'server',
      viewRows: [
        buildViewRow({
          id: 'view-1',
          name: 'Current View',
          isActive: true,
          config: { ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG, layout: 'timeline' },
        }),
        buildViewRow({
          id: 'config-view-1',
          name: 'Config',
          isActive: true,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        }),
      ],
      activeViewIdsByMode: { executions: 'view-1', config: 'config-view-1' },
      configsByMode: {
        executions: { ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG, layout: 'timeline' },
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      },
      rowStateByMode: { executions: 'server', config: 'server' },
      errorsByMode: {},
      renderableModes: ['executions', 'config'],
      initialMode: 'executions',
      viewsError: null,
    })
    mockedCreateMonitorView.mockResolvedValue(
      buildViewRow({
        id: 'view-2',
        name: 'View 1',
        isActive: true,
        config: { ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG, layout: 'timeline' },
      })
    )
    mockedCreateIndicatorMonitor.mockResolvedValue(buildMonitorRow('monitor-created') as any)
    mockedUpdateIndicatorMonitor.mockResolvedValue(buildMonitorRow('monitor-1') as any)
    mockedDeleteIndicatorMonitor.mockResolvedValue(undefined)
    mockedLoadMonitors.mockResolvedValue([])
    mockedLoadWorkflowOptions.mockResolvedValue([])
    mockedUpdateMonitorView.mockImplementation(async (_workspaceId, viewId, input) =>
      buildViewRow({
        id: viewId,
        name: viewId.startsWith('config') ? 'Config' : 'Current View',
        isActive: true,
        config:
          input.config ??
          (viewId.startsWith('config')
            ? DEFAULT_CONFIG_MONITOR_VIEW_CONFIG
            : { ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG, layout: 'timeline' }),
      })
    )
    mockedRemoveMonitorView.mockResolvedValue(undefined)
    mockedSetActiveMonitorView.mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  const findButton = (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes(label)
    )

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Expected button "${label}" to render`)
    }

    return button
  }

  const click = async (label: string) => {
    const button = findButton(label)

    await act(async () => {
      button.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
        })
      )
      button.click()
    })
  }

  const selectedExecution = () =>
    container.querySelector('[data-testid="selected-execution"]')?.textContent

  const autocompleteValue = () =>
    container.querySelector('[data-testid="autocomplete-value"]')?.textContent

  const waitForText = async (text: string) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (container.textContent?.includes(text)) {
        return
      }

      await act(async () => {
        await Promise.resolve()
      })
    }

    throw new Error(`Expected "${text}" to appear in the rendered output`)
  }

  it('creates a new view from the current effective config through the name dialog flow', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Create view')
    expect(document.body.textContent).toContain(
      'Create a new saved view from the current execution workspace settings.'
    )

    const submitButton = Array.from(document.body.querySelectorAll('button'))
      .reverse()
      .find((node) => node.textContent?.includes('Create view'))
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error('Expected dialog "Create view" button to render')
    }

    await act(async () => {
      submitButton.click()
    })

    expect(mockedCreateMonitorView).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        name: 'Executions',
        config: expect.objectContaining({ layout: 'timeline' }),
      })
    )
  })

  it('creates config-mode saved views from the page-level name dialog', async () => {
    mockedCreateMonitorView.mockResolvedValueOnce(
      buildViewRow({
        id: 'config-view-2',
        name: 'Config 2',
        isActive: true,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      })
    )

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('config')
    await click('Create view')
    expect(document.body.textContent).toContain(
      'Create a new saved view from the current monitor configuration workspace settings.'
    )

    const submitButton = Array.from(document.body.querySelectorAll('button'))
      .reverse()
      .find((node) => node.textContent?.includes('Create view'))
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error('Expected config dialog "Create view" button to render')
    }

    await act(async () => {
      submitButton.click()
    })

    expect(mockedCreateMonitorView).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        name: 'Config 2',
        config: expect.objectContaining({ mode: 'config' }),
      })
    )
  })

  it('renames the active view through the page-level name dialog', async () => {
    mockedUpdateMonitorView.mockResolvedValueOnce(
      buildViewRow({
        id: 'view-1',
        name: 'Renamed View',
        isActive: true,
        config: { ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG, layout: 'timeline' },
      })
    )

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Rename Current View')
    expect(document.body.textContent).toContain('Rename View')

    const input = document.body.querySelector('input')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Expected rename input to render')
    }

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'Renamed View')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const submitButton = Array.from(document.body.querySelectorAll('button'))
      .reverse()
      .find((node) => node.textContent?.includes('Rename view'))
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error('Expected dialog "Rename view" button to render')
    }

    await act(async () => {
      submitButton.click()
    })

    expect(mockedUpdateMonitorView).toHaveBeenCalledWith('workspace-1', 'view-1', {
      name: 'Renamed View',
    })
  })

  it('updates the active view locally and persists it before refreshing', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Change view')
    expect(autocompleteValue()).toBe('status:success')
    expect(mockedUpdateMonitorView).not.toHaveBeenCalled()

    await click('Refresh monitor workspace')
    expect(mockedUpdateMonitorView).toHaveBeenCalledWith(
      'workspace-1',
      'view-1',
      expect.objectContaining({
        config: expect.objectContaining({
          filterQuery: 'status:success',
        }),
      })
    )
  })

  it('persists dirty saved-view configs independently across mode switches', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Change view')
    await click('config')
    await click('Change config view')
    await click('executions')

    expect(mockedUpdateMonitorView).toHaveBeenCalledWith(
      'workspace-1',
      'view-1',
      expect.objectContaining({
        config: expect.objectContaining({
          filterQuery: 'status:success',
        }),
      })
    )
    expect(mockedUpdateMonitorView).toHaveBeenCalledWith(
      'workspace-1',
      'config-view-1',
      expect.objectContaining({
        config: expect.objectContaining({
          filterQuery: 'provider:#alpaca',
        }),
      })
    )
  })

  it('keeps dirty saved-view configs retryable when keepalive persistence fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'Rejected' }), { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Change view')

    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not pass folder suggestions into the monitor header search', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    expect(container.querySelector('[data-testid="autocomplete-folder-count"]')?.textContent).toBe(
      '0'
    )
  })

  it('exports execution logs with the monitor execution filter contract', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'appendChild')

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Export CSV')

    const anchor = appendSpy.mock.calls
      .map(([node]) => node)
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
    expect(anchor?.href).toContain('/api/logs/export?')
    expect(anchor?.href).toContain('workspaceId=workspace-1')
    expect(anchor?.href).toContain('triggerSource=indicator_trigger')
    expect(anchor?.href).not.toContain('limit=')
    expect(anchor?.href).not.toContain('details=')
    expect(anchor?.download).toBe('logs_export.csv')
    expect(clickSpy).toHaveBeenCalledOnce()

    appendSpy.mockRestore()
    clickSpy.mockRestore()
  })

  it('passes workspace-loaded workflow suggestions into the monitor header search', async () => {
    mockedLoadWorkflowOptions.mockResolvedValue([
      {
        workflowId: 'workflow-1',
        workflowName: 'Workflow One',
        workflowColor: '#3972F6',
      },
    ])

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    expect(
      container.querySelector('[data-testid="autocomplete-workflow-count"]')?.textContent
    ).toBe('1')
  })

  it('renders config search in the shell header', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('config')

    expect(container.querySelector('input[placeholder="Search config monitors..."]')).not.toBeNull()
  })

  it('renders the New monitor header action only in config mode', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    expect(container.textContent).not.toContain('New monitor')

    await click('config')

    expect(findButton('New monitor')).toBeInstanceOf(HTMLButtonElement)
  })

  it('keeps config mode in a loading state until monitor requirements load', async () => {
    mockedLoadIndicatorOptions.mockReturnValueOnce(new Promise(() => {}))
    mockedLoadWorkflowTargetOptions.mockReturnValueOnce(new Promise(() => {}))
    mockedLoadWorkflowOptions.mockReturnValueOnce(new Promise(() => {}))
    mockedBootstrapMonitorViews.mockResolvedValueOnce({
      viewStateMode: 'server',
      viewRows: [
        buildViewRow({ id: 'view-1', name: 'Executions', isActive: true }),
        buildViewRow({
          id: 'config-view-1',
          name: 'Config',
          isActive: true,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        }),
      ],
      activeViewIdsByMode: { executions: 'view-1', config: 'config-view-1' },
      configsByMode: {
        executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      },
      rowStateByMode: { executions: 'server', config: 'server' },
      errorsByMode: {},
      renderableModes: ['executions', 'config'],
      initialMode: 'config',
      viewsError: null,
    })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await waitForText('Loading monitor requirements...')

    expect(container.querySelector('[data-testid="config-create-request-id"]')).toBeNull()
    expect(findButton('config').disabled).toBe(true)
    expect(findButton('New monitor').disabled).toBe(true)
  })

  it('shows quick filters alongside the shared header query and removes them from that surface', async () => {
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: 'server',
      viewRows: [buildViewRow({ id: 'view-1', name: 'Current View', isActive: true })],
      activeViewIdsByMode: { executions: 'view-1' },
      configsByMode: {
        executions: {
          ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
        },
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      },
      rowStateByMode: { executions: 'server', config: 'server' },
      errorsByMode: {},
      renderableModes: ['executions', 'config'],
      initialMode: 'executions',
      viewsError: null,
    })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    expect(autocompleteValue()).toBe('')
    expect(container.querySelector('[data-testid="autocomplete-external"]')?.textContent).toContain(
      'provider:#alpaca'
    )

    await click('Remove provider:#alpaca')
    expect(
      container.querySelector('[data-testid="autocomplete-external"]')?.textContent
    ).not.toContain('provider:#alpaca')
  })

  it('removes a committed header query clause when the canvas toggles the same filter', async () => {
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: 'server',
      viewRows: [buildViewRow({ id: 'view-1', name: 'Current View', isActive: true })],
      activeViewIdsByMode: { executions: 'view-1' },
      configsByMode: {
        executions: {
          ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          filterQuery: 'provider:#alpaca',
        },
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      },
      rowStateByMode: { executions: 'server', config: 'server' },
      errorsByMode: {},
      renderableModes: ['executions', 'config'],
      initialMode: 'executions',
      viewsError: null,
    })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    expect(autocompleteValue()).toBe('provider:#alpaca')

    await click('Toggle provider filter')

    expect(autocompleteValue()).toBe('')
  })

  it('clears execution selection when switching saved views', async () => {
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: 'server',
      viewRows: [
        buildViewRow({ id: 'view-1', name: 'Current View', isActive: true }),
        buildViewRow({ id: 'view-2', name: 'Second View', isActive: false }),
      ],
      activeViewIdsByMode: { executions: 'view-1' },
      configsByMode: {
        executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      },
      rowStateByMode: { executions: 'server', config: 'server' },
      errorsByMode: {},
      renderableModes: ['executions', 'config'],
      initialMode: 'executions',
      viewsError: null,
    })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })
    await waitForText('Second View')
    await click('Current View')

    await click('Select execution')
    expect(selectedExecution()).toBe('log-1')

    await click('Second View')
    expect(mockedSetActiveMonitorView).toHaveBeenCalledWith('workspace-1', 'view-2')
    expect(selectedExecution()).toBe('none')
  })

  it('clears execution selection when switching away from execution mode', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Select execution')
    expect(selectedExecution()).toBe('log-1')

    await click('config')
    expect(container.querySelector('[data-testid="selected-execution"]')).toBeNull()

    await click('executions')
    expect(selectedExecution()).toBe('none')
  })

  it('keeps execution selection when mode switching fails before persistence completes', async () => {
    mockedUpdateMonitorView.mockRejectedValueOnce(new Error('Failed to save view'))

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Select execution')
    await click('Change view')
    await click('config')

    expect(selectedExecution()).toBe('log-1')
    expect(container.querySelector('[data-testid="views-error"]')?.textContent).toBe(
      'Failed to save view'
    )
  })

  it('falls back to a same-mode view when deleting the active view before reload', async () => {
    mockedBootstrapMonitorViews
      .mockResolvedValueOnce({
        viewStateMode: 'server',
        viewRows: [
          buildViewRow({ id: 'view-1', name: 'Current View', isActive: true }),
          buildViewRow({ id: 'view-2', name: 'Second View', isActive: false }),
          buildViewRow({
            id: 'config-view-1',
            name: 'Config',
            isActive: true,
            config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
          }),
        ],
        activeViewIdsByMode: { executions: 'view-1', config: 'config-view-1' },
        configsByMode: {
          executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        },
        rowStateByMode: { executions: 'server', config: 'server' },
        errorsByMode: {},
        renderableModes: ['executions', 'config'],
        initialMode: 'executions',
        viewsError: null,
      })
      .mockResolvedValueOnce({
        viewStateMode: 'error',
        viewRows: [],
        activeViewIdsByMode: {},
        configsByMode: {
          executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        },
        rowStateByMode: { executions: 'error', config: 'error' },
        errorsByMode: {},
        renderableModes: [],
        initialMode: 'executions',
        viewsError: 'Failed to refresh views',
      })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })
    await waitForText('Second View')
    await click('Select execution')
    expect(selectedExecution()).toBe('log-1')

    await click('Delete Current View')
    await waitForText('Failed to refresh views')

    expect(mockedRemoveMonitorView).toHaveBeenCalledWith('workspace-1', 'view-1')
    expect(selectedExecution()).toBe('none')
    expect(findButton('Second View').dataset.active).toBe('true')
    expect(container.textContent).not.toContain('Current View')
  })

  it('blocks stale saved-view dialog submission after the active mode changes', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Rename Current View')
    await click('config')

    const submitButton = Array.from(document.body.querySelectorAll('button'))
      .reverse()
      .find((node) => node.textContent?.includes('Rename view'))
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error('Expected dialog "Rename view" button to render')
    }

    await act(async () => {
      submitButton.click()
    })

    expect(mockedUpdateMonitorView).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="config-views-error"]')?.textContent).toBe(
      'Saved view dialog is stale. Close it and try again.'
    )
    expect(document.body.textContent).toContain('Rename View')
  })

  it('locks shell header actions while a view mutation is in flight', async () => {
    mockedLoadIndicatorOptions.mockResolvedValueOnce([
      { id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' },
    ])
    mockedLoadWorkflowTargetOptions.mockResolvedValueOnce([
      {
        workflowId: 'workflow-1',
        blockId: 'block-1',
        workflowName: 'Workflow One',
        workflowColor: '#3972F6',
        isDeployed: true,
        blockName: 'Indicator Trigger',
        label: 'Workflow One - Indicator Trigger',
      },
    ])
    mockedBootstrapMonitorViews.mockResolvedValueOnce({
      viewStateMode: 'server',
      viewRows: [
        buildViewRow({ id: 'view-1', name: 'Executions', isActive: true }),
        buildViewRow({
          id: 'config-view-1',
          name: 'Config',
          isActive: true,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        }),
        buildViewRow({
          id: 'config-view-2',
          name: 'Config 2',
          isActive: false,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        }),
      ],
      activeViewIdsByMode: { executions: 'view-1', config: 'config-view-1' },
      configsByMode: {
        executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      },
      rowStateByMode: { executions: 'server', config: 'server' },
      errorsByMode: {},
      renderableModes: ['executions', 'config'],
      initialMode: 'config',
      viewsError: null,
    })
    let resolveRemove: (() => void) | null = null
    mockedRemoveMonitorView.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRemove = resolve
      })
    )

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })
    await waitForText('Config 2')

    await click('Delete Config')

    expect(findButton('Create view').disabled).toBe(true)
    expect(findButton('executions').disabled).toBe(true)
    expect(findButton('config').disabled).toBe(true)
    expect(findButton('Refresh monitor workspace').disabled).toBe(true)
    expect(findButton('New monitor').disabled).toBe(true)

    await act(async () => {
      resolveRemove?.()
      await Promise.resolve()
    })
  })

  it('deletes inactive views through the header tabs', async () => {
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: 'server',
      viewRows: [
        buildViewRow({ id: 'view-1', name: 'Current View', isActive: true }),
        buildViewRow({ id: 'view-2', name: 'Second View', isActive: false }),
      ],
      activeViewIdsByMode: { executions: 'view-1' },
      configsByMode: {
        executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      },
      rowStateByMode: { executions: 'server', config: 'server' },
      errorsByMode: {},
      renderableModes: ['executions', 'config'],
      initialMode: 'executions',
      viewsError: null,
    })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })
    await waitForText('Second View')

    await click('Select execution')
    expect(selectedExecution()).toBe('log-1')

    await click('Delete Second View')

    expect(mockedRemoveMonitorView).toHaveBeenCalledWith('workspace-1', 'view-2')
    expect(selectedExecution()).toBe('log-1')
  })

  it('routes monitor CRUD mutations through the page-level callbacks', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('config')
    await click('Create monitor')
    expect(mockedCreateIndicatorMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      })
    )

    await click('Toggle monitor')
    expect(mockedUpdateIndicatorMonitor).toHaveBeenCalledWith(
      'monitor-1',
      expect.objectContaining({
        workspaceId: 'workspace-1',
        isActive: false,
      })
    )

    await click('Delete monitor')
    expect(mockedDeleteIndicatorMonitor).toHaveBeenCalledWith('monitor-1')
  })

  it('refreshes the full monitor workspace from the page shell', async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    expect(mockedBootstrapMonitorViews).toHaveBeenCalledTimes(1)
    expect(mockedLoadMonitors).toHaveBeenCalledTimes(1)
    expect(mockedLoadWorkflowOptions).toHaveBeenCalledTimes(1)

    await click('Refresh monitor workspace')

    expect(mockedBootstrapMonitorViews).toHaveBeenCalledTimes(2)
    expect(mockedLoadMonitors).toHaveBeenCalledTimes(2)
    expect(mockedLoadWorkflowOptions).toHaveBeenCalledTimes(1)
  })

  it('locks shell header actions while a full refresh is in flight', async () => {
    let resolveRefreshLoad: (() => void) | null = null

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    mockedLoadMonitors.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefreshLoad = () => resolve([])
      })
    )

    await click('Refresh monitor workspace')

    expect(findButton('Create view').disabled).toBe(true)
    expect(findButton('config').disabled).toBe(true)
    expect(findButton('Refresh monitor workspace').disabled).toBe(true)
    expect(container.textContent).not.toContain('New monitor')

    await act(async () => {
      resolveRefreshLoad?.()
      await Promise.resolve()
    })
  })

  it('renders a shell-level fatal view error when initial bootstrap fails', async () => {
    mockedBootstrapMonitorViews.mockResolvedValueOnce({
      viewStateMode: 'error',
      viewRows: [],
      activeViewIdsByMode: {},
      configsByMode: {
        executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      },
      rowStateByMode: { executions: 'error', config: 'error' },
      errorsByMode: {},
      renderableModes: [],
      initialMode: 'executions',
      viewsError: 'Failed to load views',
    })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    expect(container.textContent).toContain('Views unavailable')
    expect(container.textContent).toContain('Failed to load views')
    expect(container.querySelector('[data-testid="selected-execution"]')).toBeNull()
    expect(container.querySelector('[data-testid="config-create-request-id"]')).toBeNull()
  })

  it('keeps the current shell state when a non-initial view reload fails', async () => {
    mockedBootstrapMonitorViews
      .mockResolvedValueOnce({
        viewStateMode: 'server',
        viewRows: [buildViewRow({ id: 'view-1', name: 'Current View', isActive: true })],
        activeViewIdsByMode: { executions: 'view-1' },
        configsByMode: {
          executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        },
        rowStateByMode: { executions: 'server', config: 'server' },
        errorsByMode: {},
        renderableModes: ['executions', 'config'],
        initialMode: 'executions',
        viewsError: null,
      })
      .mockResolvedValueOnce({
        viewStateMode: 'error',
        viewRows: [],
        activeViewIdsByMode: {},
        configsByMode: {
          executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        },
        rowStateByMode: { executions: 'error', config: 'error' },
        errorsByMode: {},
        renderableModes: [],
        initialMode: 'executions',
        viewsError: 'Failed to refresh views',
      })

    await act(async () => {
      root.render(<MonitorPage workspaceId='workspace-1' userId='user-1' />)
    })

    await click('Select execution')
    expect(selectedExecution()).toBe('log-1')

    await click('Refresh monitor workspace')

    expect(selectedExecution()).toBe('log-1')
    expect(container.textContent).toContain('Current View')
    expect(container.textContent).not.toContain('Views unavailable')
    expect(container.querySelector('[data-testid="views-error"]')?.textContent).toBe(
      'Failed to refresh views'
    )
  })
})
