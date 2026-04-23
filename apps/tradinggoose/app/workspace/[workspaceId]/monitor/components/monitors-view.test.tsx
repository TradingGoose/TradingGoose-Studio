/**
 * @vitest-environment jsdom
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorsView, type MonitorsViewProps } from './monitors-view'
import { DEFAULT_MONITOR_VIEW_CONFIG } from './view-config'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const apiMocks = vi.hoisted(() => ({
  activateMonitorView: vi.fn(),
  createMonitorView: vi.fn(),
  loadIndicatorOptions: vi.fn().mockResolvedValue([]),
  loadMonitors: vi.fn().mockResolvedValue([]),
  loadWorkflowOptions: vi.fn().mockResolvedValue([]),
  loadWorkflowTargetOptions: vi.fn().mockResolvedValue([]),
  removeMonitorView: vi.fn(),
  updateMonitorView: vi.fn(),
}))

const logsHooksMocks = vi.hoisted(() => ({
  useLogDetail: vi.fn(),
  useLogsList: vi.fn(),
}))

const boardStateMocks = vi.hoisted(() => ({
  buildMonitorBoardColumns: vi.fn(),
  buildMonitorEntities: vi.fn(),
  filterMonitorEntities: vi.fn(),
  getDefaultPanelSizes: vi.fn(),
  getMonitorFilterOptions: vi.fn(),
  getMonitorStatusLabel: vi.fn(),
  shouldEnableTriggerControls: vi.fn(),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: (value: boolean) => void
  }) => (
    <input
      type='checkbox'
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: ReactNode
    open?: boolean
  }) => <div data-dialog-open={open ? 'true' : 'false'}>{open ? children : null}</div>,
  DialogContent: ({ children }: { children?: ReactNode }) => <div data-testid='dialog-content'>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type='button' disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <div />,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/resizable', () => ({
  ResizableHandle: () => <div />,
  ResizablePanel: ({
    children,
    order,
  }: {
    children?: ReactNode
    order?: number
  }) => <div data-testid={order ? `resizable-panel-${order}` : 'resizable-panel'}>{children}</div>,
  ResizablePanelGroup: ({ children }: { children?: ReactNode }) => (
    <div data-testid='resizable-panel-group'>{children}</div>
  ),
}))

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <div />,
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children, open }: { children?: ReactNode; open?: boolean }) => (
    <div data-sheet-open={open ? 'true' : 'false'}>{open ? children : null}</div>
  ),
  SheetContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: (value: boolean) => void
  }) => (
    <input
      type='checkbox'
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('@/app/workspace/[workspaceId]/logs/components/log-details/log-details', () => ({
  LogDetails: ({
    log,
    onClose,
  }: {
    log: { id: string } | null
    onClose?: () => void
  }) => (
    <div>
      <div>{`Log details:${log?.id ?? 'none'}`}</div>
      <button type='button' onClick={onClose}>
        Close log details
      </button>
    </div>
  ),
}))

vi.mock('@/hooks/queries/logs', () => ({
  useLogDetail: logsHooksMocks.useLogDetail,
  useLogsList: logsHooksMocks.useLogsList,
}))

vi.mock('@/providers/market/providers', () => ({
  getMarketLiveCapabilities: () => null,
  getMarketProviderOptionsByKind: () => [],
  getMarketProviderParamDefinitions: () => [],
  getMarketSeriesCapabilities: () => ({ intervals: [] }),
}))

vi.mock('@/stores/market/selector/store', () => ({
  useListingSelectorStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      ensureInstance: vi.fn(),
      updateInstance: vi.fn(),
    }),
}))

vi.mock('./api', () => apiMocks)
vi.mock('./board-state', () => boardStateMocks)

vi.mock('./monitor-board', () => ({
  MonitorBoard: () => <div>Monitor kanban</div>,
}))

vi.mock('./monitor-editor-modal', () => ({
  MonitorEditorModal: () => <div>Monitor editor</div>,
}))

vi.mock('./monitor-roadmap', () => ({
  MonitorRoadmap: () => <div>Monitor timeline</div>,
}))

vi.mock('./roadmap-state', () => ({
  buildMonitorRoadmapGroups: vi.fn().mockReturnValue([]),
}))

vi.mock('./searchable-dropdown', () => ({
  SearchableDropdown: ({
    value,
    options,
    placeholder,
    disabled,
    onValueChange,
  }: {
    value?: string | null
    options: Array<{ value: string; label: string }>
    placeholder?: string
    disabled?: boolean
    onValueChange?: (value: string) => void
  }) => {
    const selected = options.find((option) => option.value === value)

    return (
      <button
        type='button'
        disabled={disabled}
        onClick={() => {
          if (!disabled && options[0]) {
            onValueChange?.(options[0].value)
          }
        }}
      >
        {selected?.label ?? placeholder ?? 'Select'}
      </button>
    )
  },
}))

vi.mock('./utils', () => ({
  buildDefaultDraft: vi.fn().mockReturnValue({
    workflowId: '',
    blockId: '',
    providerId: '',
    interval: '',
    indicatorId: '',
    listing: null,
    secretValues: {},
    providerParamValues: {},
    existingEncryptedSecretFieldIds: [],
    isActive: true,
  }),
  buildDraftFromMonitor: vi.fn(),
  isAuthParamDefinition: vi.fn().mockReturnValue(false),
  parseErrorMessage: vi.fn().mockResolvedValue('Failed request'),
}))

const selectedMonitor = {
  monitorId: 'monitor-1',
  workflowId: 'wf-1',
  blockId: 'trigger-a',
  isActive: true,
  providerConfig: {
    triggerId: 'indicator_trigger' as const,
    version: 1 as const,
    monitor: {
      providerId: 'alpaca',
      interval: '1m',
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default' as const,
      },
      indicatorId: 'rsi',
    },
  },
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-22T00:00:00.000Z',
}

const selectedEntity = {
  id: 'monitor-1',
  monitor: selectedMonitor,
  workflowName: 'Momentum',
  workflowColor: '#3972F6',
  workflowTarget: null,
  indicatorName: 'RSI',
  indicatorColor: '#ff6600',
  providerName: 'Alpaca',
  providerIcon: undefined,
  triggerId: 'indicator_trigger',
  triggerName: 'Indicator Trigger',
  listingOption: null,
  listingLabel: 'AAPL',
  listingSortKey: 'aapl',
  assetTypeKey: 'stock',
  assetTypeLabel: 'STOCK',
  primaryStatus: 'running',
  secondaryStatuses: [],
  authConfigured: true,
  needsDeploy: false,
  canPause: true,
  canResume: false,
  updatedAtDate: new Date('2026-04-22T00:00:00.000Z'),
  createdAtDate: new Date('2026-04-20T00:00:00.000Z'),
}

const createProps = (
  overrides: Partial<MonitorsViewProps> = {},
  stateOverrides: Partial<MonitorsViewProps['state']> = {}
): MonitorsViewProps => {
  const baseState = {
    monitors: [],
    monitorsLoading: false,
    referenceLoading: false,
    monitorsError: null,
    referenceWarning: null,
    indicatorOptions: [],
    workflowTargets: [],
    workflowOptions: [],
    selectedMonitorId: null,
    search: '',
    viewOptionsOpen: false,
    viewRows: [
      {
        id: 'view-1',
        name: 'Default View',
        sortOrder: 0,
        isActive: true,
        config: DEFAULT_MONITOR_VIEW_CONFIG,
        createdAt: '2026-04-22T00:00:00.000Z',
        updatedAt: '2026-04-22T00:00:00.000Z',
      },
    ],
    activeViewId: 'view-1',
    viewConfig: DEFAULT_MONITOR_VIEW_CONFIG,
    viewStateMode: 'server' as const,
    viewStateReloading: false,
    viewsError: null,
    nameDialogMode: null,
    nameDialogValue: '',
    nameDialogBusy: false,
    deletingViewId: null,
    isEditorOpen: false,
    editingKey: null,
    editingDraft: null,
    editingErrors: {},
    saving: false,
    togglingMonitorId: null,
    deletingMonitorId: null,
    pendingMonitorDelete: null,
  } satisfies MonitorsViewProps['state']

  const baseSetters = {
    setMonitors: vi.fn(),
    setMonitorsLoading: vi.fn(),
    setReferenceLoading: vi.fn(),
    setMonitorsError: vi.fn(),
    setReferenceWarning: vi.fn(),
    setIndicatorOptions: vi.fn(),
    setWorkflowTargets: vi.fn(),
    setWorkflowOptions: vi.fn(),
    setSelectedMonitorId: vi.fn(),
    setSearch: vi.fn(),
    setViewOptionsOpen: vi.fn(),
    setViewRows: vi.fn(),
    setActiveViewId: vi.fn(),
    setViewConfig: vi.fn(),
    setViewStateMode: vi.fn(),
    setViewsError: vi.fn(),
    setNameDialogMode: vi.fn(),
    setNameDialogValue: vi.fn(),
    setNameDialogBusy: vi.fn(),
    setDeletingViewId: vi.fn(),
    setIsEditorOpen: vi.fn(),
    setEditingKey: vi.fn(),
    setEditingDraft: vi.fn(),
    setEditingErrors: vi.fn(),
    setSaving: vi.fn(),
    setTogglingMonitorId: vi.fn(),
    setDeletingMonitorId: vi.fn(),
    setPendingMonitorDelete: vi.fn(),
  } satisfies MonitorsViewProps['setters']

  return {
    workspaceId: 'workspace-1',
    reloadViewState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
    state: {
      ...baseState,
      ...(overrides.state ?? {}),
      ...stateOverrides,
    },
    setters: {
      ...baseSetters,
      ...(overrides.setters ?? {}),
    },
  }
}

describe('MonitorsView', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    logsHooksMocks.useLogDetail.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    })
    logsHooksMocks.useLogsList.mockReturnValue({
      data: {
        pages: [{ logs: [], hasMore: false, nextPage: undefined }],
      },
      error: null,
      isError: false,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn().mockResolvedValue(undefined),
      refetch: vi.fn().mockResolvedValue(undefined),
    })
    boardStateMocks.buildMonitorBoardColumns.mockReturnValue([])
    boardStateMocks.buildMonitorEntities.mockReturnValue([])
    boardStateMocks.filterMonitorEntities.mockReturnValue([])
    boardStateMocks.getDefaultPanelSizes.mockReturnValue([76, 24])
    boardStateMocks.getMonitorFilterOptions.mockReturnValue({
      triggers: [],
      providers: [],
      intervals: [],
      assetTypes: [],
    })
    boardStateMocks.getMonitorStatusLabel.mockReturnValue('Running')
    boardStateMocks.shouldEnableTriggerControls.mockReturnValue(false)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.clearAllMocks()
  })

  it('shows the error-mode view chrome without any local fallback actions', async () => {
    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            viewRows: [],
            activeViewId: null,
            viewStateMode: 'error',
            viewsError: 'Views offline',
          })}
        />
      )
    })

    expect(container.textContent).toContain('Views unavailable')
    expect(container.textContent).toContain('View options')
    expect(container.textContent).not.toContain('Save local view')
    expect(container.textContent).not.toContain('Local view')
  })

  it('renders the kanban surface instead of a generic empty-state blocker when the filtered dataset is empty', async () => {
    await act(async () => {
      root.render(<MonitorsView {...createProps()} />)
    })

    expect(container.textContent).toContain('Monitor kanban')
    expect(container.textContent).not.toContain('No monitors match the current view')
  })

  it('renders the timeline surface instead of a generic empty-state blocker when the filtered dataset is empty', async () => {
    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            viewConfig: {
              ...DEFAULT_MONITOR_VIEW_CONFIG,
              layout: 'roadmap',
            },
          })}
        />
      )
    })

    expect(container.textContent).toContain('Monitor timeline')
    expect(container.textContent).not.toContain('No monitors match the current view')
  })

  it('routes refresh through view-state reload', async () => {
    const reloadViewState = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      root.render(<MonitorsView {...createProps({ reloadViewState })} />)
    })

    const refreshButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Refresh')
    )

    if (!(refreshButton instanceof HTMLButtonElement)) {
      throw new Error('Expected refresh button to render')
    }

    await act(async () => {
      refreshButton.click()
    })

    expect(reloadViewState).toHaveBeenCalledTimes(1)
  })

  it('opens view options from the toolbar and renders the dialog content only when requested', async () => {
    const setViewOptionsOpen = vi.fn()

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps(
            {
              setters: {
                ...createProps().setters,
                setViewOptionsOpen,
              },
            },
            {
              viewOptionsOpen: false,
            }
          )}
        />
      )
    })

    expect(container.textContent).not.toContain('Kanban grouping')

    const viewOptionsButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('View options')
    )

    if (!(viewOptionsButton instanceof HTMLButtonElement)) {
      throw new Error('Expected view options button to render')
    }

    await act(async () => {
      viewOptionsButton.click()
    })

    expect(setViewOptionsOpen).toHaveBeenCalledWith(true)

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            viewOptionsOpen: true,
          })}
        />
      )
    })

    expect(container.textContent).toContain('Kanban grouping')
    expect(container.textContent).toContain('View options')
  })

  it('clears selection instead of auto-selecting a replacement when the current monitor falls out of the filtered dataset', async () => {
    const setSelectedMonitorId = vi.fn()

    boardStateMocks.buildMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.filterMonitorEntities.mockReturnValue([selectedEntity])

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps(
            {
              setters: {
                ...createProps().setters,
                setSelectedMonitorId,
              },
            },
            {
              selectedMonitorId: 'missing-monitor',
            }
          )}
        />
      )
    })

    expect(setSelectedMonitorId).toHaveBeenCalledWith(null)
    expect(setSelectedMonitorId).not.toHaveBeenCalledWith('monitor-1')
  })

  it('keeps the no-selection desktop state full width after an explicit inspector close', async () => {
    const setSelectedMonitorId = vi.fn()

    boardStateMocks.buildMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.filterMonitorEntities.mockReturnValue([selectedEntity])
    logsHooksMocks.useLogsList.mockReturnValue({
      data: {
        pages: [{ logs: [{ id: 'log-1' }], hasMore: false, nextPage: undefined }],
      },
      error: null,
      isError: false,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn().mockResolvedValue(undefined),
      refetch: vi.fn().mockResolvedValue(undefined),
    })
    logsHooksMocks.useLogDetail.mockReturnValue({
      data: { id: 'log-1' },
      error: null,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    })

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps(
            {
              setters: {
                ...createProps().setters,
                setSelectedMonitorId,
              },
            },
            {
              selectedMonitorId: 'monitor-1',
            }
          )}
        />
      )
    })

    expect(container.querySelector('[data-testid=\"resizable-panel-group\"]')).not.toBeNull()

    const closeButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Close log details')
    )

    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error('Expected log details close button to render')
    }

    await act(async () => {
      closeButton.click()
    })

    expect(setSelectedMonitorId).toHaveBeenCalledWith(null)

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps(
            {
              setters: {
                ...createProps().setters,
                setSelectedMonitorId,
              },
            },
            {
              selectedMonitorId: null,
            }
          )}
        />
      )
    })

    expect(setSelectedMonitorId).not.toHaveBeenCalledWith('monitor-1')
    expect(container.querySelector('[data-testid=\"resizable-panel-group\"]')).toBeNull()
  })

  it('uses the fixed latest-log query contract', async () => {
    boardStateMocks.buildMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.filterMonitorEntities.mockReturnValue([selectedEntity])

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            selectedMonitorId: 'monitor-1',
          })}
        />
      )
    })

    expect(logsHooksMocks.useLogsList).toHaveBeenCalledWith(
      'workspace-1',
      {
        timeRange: 'All time',
        level: 'all',
        workflowIds: ['wf-1'],
        folderIds: [],
        triggers: [],
        searchQuery: '',
        limit: 1,
        monitorId: 'monitor-1',
        listing: selectedMonitor.providerConfig.monitor.listing,
        indicatorId: 'rsi',
        providerId: 'alpaca',
        interval: '1m',
        triggerSource: 'indicator_trigger',
      },
      {
        enabled: true,
        refetchInterval: false,
      }
    )
  })

  it('shows the no-log inspector state when the selected monitor has no matching latest log', async () => {
    boardStateMocks.buildMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.filterMonitorEntities.mockReturnValue([selectedEntity])

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            selectedMonitorId: 'monitor-1',
          })}
        />
      )
    })

    expect(container.textContent).toContain('No log history yet')
    expect(container.textContent).not.toContain('Log details:')
  })

  it('keeps the selected monitor pinned and shows a retryable latest-log error state', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)

    boardStateMocks.buildMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.filterMonitorEntities.mockReturnValue([selectedEntity])
    logsHooksMocks.useLogsList.mockReturnValue({
      data: null,
      error: new Error('Lookup failed'),
      isError: true,
      isSuccess: false,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn().mockResolvedValue(undefined),
      refetch,
    })

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            selectedMonitorId: 'monitor-1',
          })}
        />
      )
    })

    expect(container.textContent).toContain('Unable to load latest log')
    expect(container.textContent).toContain('Lookup failed')

    const retryButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Retry latest log lookup')
    )

    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error('Expected latest-log retry button to render')
    }

    await act(async () => {
      retryButton.click()
    })

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('hides single-option dynamic filter controls after loading settles even when the saved view still contains those values', async () => {
    boardStateMocks.buildMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.filterMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.getMonitorFilterOptions.mockReturnValue({
      triggers: [{ value: 'indicator_trigger', label: 'Indicator Trigger' }],
      providers: [{ value: 'alpaca', label: 'Alpaca' }],
      intervals: [{ value: '1m', label: '1m' }],
      assetTypes: [{ value: 'stock', label: 'Stock' }],
    })

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            viewOptionsOpen: true,
            viewConfig: {
              ...DEFAULT_MONITOR_VIEW_CONFIG,
              filters: {
                ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
                triggerIds: ['indicator_trigger'],
                providerIds: ['alpaca'],
                intervals: ['1m'],
                assetTypes: ['stock'],
              },
            },
          })}
        />
      )
    })

    expect(container.textContent).toContain('Kanban grouping')
    expect(container.textContent).not.toContain('Trigger')
    expect(container.textContent).not.toContain('Provider')
    expect(container.textContent).not.toContain('Interval')
    expect(container.textContent).not.toContain('Asset type')
  })

  it('suppresses stale log detail until the latest detail id matches the selected monitor log', async () => {
    boardStateMocks.buildMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.filterMonitorEntities.mockReturnValue([selectedEntity])
    logsHooksMocks.useLogsList.mockReturnValue({
      data: {
        pages: [{ logs: [{ id: 'log-new' }], hasMore: false, nextPage: undefined }],
      },
      error: null,
      isError: false,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn().mockResolvedValue(undefined),
      refetch: vi.fn().mockResolvedValue(undefined),
    })
    logsHooksMocks.useLogDetail.mockReturnValue({
      data: { id: 'log-old' },
      error: null,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    })

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            selectedMonitorId: 'monitor-1',
          })}
        />
      )
    })

    expect(container.textContent).toContain('Loading log detail')
    expect(container.textContent).not.toContain('Log details:log-old')
  })

  it('keeps the selected monitor pinned and shows a retryable log-detail error state', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)

    boardStateMocks.buildMonitorEntities.mockReturnValue([selectedEntity])
    boardStateMocks.filterMonitorEntities.mockReturnValue([selectedEntity])
    logsHooksMocks.useLogsList.mockReturnValue({
      data: {
        pages: [{ logs: [{ id: 'log-1' }], hasMore: false, nextPage: undefined }],
      },
      error: null,
      isError: false,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn().mockResolvedValue(undefined),
      refetch: vi.fn().mockResolvedValue(undefined),
    })
    logsHooksMocks.useLogDetail.mockReturnValue({
      data: null,
      error: new Error('Detail failed'),
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      refetch,
    })

    await act(async () => {
      root.render(
        <MonitorsView
          {...createProps({}, {
            selectedMonitorId: 'monitor-1',
          })}
        />
      )
    })

    expect(container.textContent).toContain('Unable to load log detail')
    expect(container.textContent).toContain('Detail failed')

    const retryButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Retry log detail')
    )

    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error('Expected log-detail retry button to render')
    }

    await act(async () => {
      retryButton.click()
    })

    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
