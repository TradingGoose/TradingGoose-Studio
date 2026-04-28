/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG } from '../view/view-config'
import { MonitorExecutionWorkspace } from './monitor-execution-workspace'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
  ResizeObserver?: typeof ResizeObserver
}

const ResizeObserverMock = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const findCombobox = (text: string) => {
  const combobox = Array.from(document.querySelectorAll('[role="combobox"]')).find((node) =>
    node.textContent?.includes(text)
  )

  if (!(combobox instanceof HTMLElement)) {
    throw new Error(`Expected select trigger containing "${text}" to render`)
  }

  return combobox
}

const selectOption = async (triggerText: string, optionText: string) => {
  const trigger = findCombobox(triggerText)

  await act(async () => {
    const event = new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    trigger.dispatchEvent(event)
  })

  const option = Array.from(document.querySelectorAll('[role="option"]')).find((node) =>
    node.textContent?.includes(optionText)
  )

  if (!(option instanceof HTMLElement)) {
    throw new Error(`Expected select option containing "${optionText}" to render`)
  }

  await act(async () => {
    option.click()
  })
}

describe('MonitorExecutionWorkspace', () => {
  let container: HTMLDivElement
  let root: Root
  let originalResizeObserver: typeof ResizeObserver | undefined
  let originalHasPointerCapture: typeof Element.prototype.hasPointerCapture | undefined
  let originalReleasePointerCapture: typeof Element.prototype.releasePointerCapture | undefined
  let originalSetPointerCapture: typeof Element.prototype.setPointerCapture | undefined
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    originalResizeObserver = reactActEnvironment.ResizeObserver
    reactActEnvironment.ResizeObserver = ResizeObserverMock
    originalHasPointerCapture = Element.prototype.hasPointerCapture
    originalReleasePointerCapture = Element.prototype.releasePointerCapture
    originalSetPointerCapture = Element.prototype.setPointerCapture
    originalScrollIntoView = Element.prototype.scrollIntoView
    Object.defineProperty(Element.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    })
    Object.defineProperty(Element.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(Element.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
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
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (originalResizeObserver) {
      reactActEnvironment.ResizeObserver = originalResizeObserver
    } else {
      Reflect.deleteProperty(reactActEnvironment, 'ResizeObserver')
    }
    if (originalHasPointerCapture) {
      Element.prototype.hasPointerCapture = originalHasPointerCapture
    } else {
      Reflect.deleteProperty(Element.prototype, 'hasPointerCapture')
    }
    if (originalReleasePointerCapture) {
      Element.prototype.releasePointerCapture = originalReleasePointerCapture
    } else {
      Reflect.deleteProperty(Element.prototype, 'releasePointerCapture')
    }
    if (originalSetPointerCapture) {
      Element.prototype.setPointerCapture = originalSetPointerCapture
    } else {
      Reflect.deleteProperty(Element.prototype, 'setPointerCapture')
    }
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('shows the dedicated unavailable shell when monitor views fail to load', async () => {
    const onReloadViews = vi.fn()

    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode='error'
          viewStateReloading={false}
          viewsError='Failed to load monitor views'
          effectiveConfig={DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId={null}
          selectedExecution={null}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          panelSizes={null}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onReloadViews={onReloadViews}
        />
      )
    })

    expect(container.textContent).toContain('Views unavailable')
    expect(container.textContent).toContain('Failed to load monitor views')

    const reloadButton = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Reload views')
    )

    if (!(reloadButton instanceof HTMLButtonElement)) {
      throw new Error('Expected reload button to render')
    }

    await act(async () => {
      reloadButton.click()
    })

    expect(onReloadViews).toHaveBeenCalledOnce()
  })

  it('requires detail-route data before rendering the inspector body', async () => {
    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId='log-1'
          selectedExecution={{
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
            sourceLog: {
              id: 'log-1',
              workspaceId: 'workspace-1',
              workflowId: 'wf-1',
              executionId: 'exec-1',
              level: 'info',
              trigger: 'manual',
              startedAt: '2026-04-23T00:00:00.000Z',
              recordCreatedAt: '2026-04-23T00:00:00.000Z',
              endedAt: '2026-04-23T00:05:00.000Z',
              durationMs: 300000,
              outcome: 'success',
              workflow: {
                id: 'wf-1',
                name: 'Workflow One',
                description: null,
                color: '#3972F6',
                folderId: null,
                folderName: null,
                userId: 'user-1',
                workspaceId: 'workspace-1',
                createdAt: '2026-04-23T00:00:00.000Z',
                updatedAt: '2026-04-23T00:00:00.000Z',
              },
            },
          }}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          panelSizes={null}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onReloadViews={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Execution details unavailable')
  })

  it('surfaces partial execution snapshot state in the inspector context strip', async () => {
    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId='log-1'
          selectedExecution={{
            logId: 'log-1',
            workflowId: 'wf-1',
            executionId: 'exec-1',
            startedAt: '2026-04-23T00:00:00.000Z',
            endedAt: null,
            durationMs: null,
            outcome: 'success',
            trigger: 'manual',
            workflowName: 'Workflow One',
            workflowColor: '#3972F6',
            monitorId: 'monitor-1',
            providerId: null,
            interval: null,
            indicatorId: null,
            assetType: 'stock',
            listing: null,
            listingLabel: 'AAPL',
            cost: null,
            isOrphaned: false,
            isPartial: true,
            sourceLog: {
              id: 'log-1',
              workspaceId: 'workspace-1',
              workflowId: 'wf-1',
              executionId: 'exec-1',
              level: 'info',
              trigger: 'manual',
              startedAt: '2026-04-23T00:00:00.000Z',
              recordCreatedAt: '2026-04-23T00:00:00.000Z',
              endedAt: null,
              durationMs: null,
              outcome: 'success',
              workflow: {
                id: 'wf-1',
                name: 'Workflow One',
                description: null,
                color: '#3972F6',
                folderId: null,
                folderName: null,
                userId: 'user-1',
                workspaceId: 'workspace-1',
                createdAt: '2026-04-23T00:00:00.000Z',
                updatedAt: '2026-04-23T00:00:00.000Z',
              },
            },
          }}
          selectedExecutionLog={{
            id: 'log-1',
            workspaceId: 'workspace-1',
            workflowId: 'wf-1',
            executionId: 'exec-1',
            level: 'info',
            trigger: 'manual',
            startedAt: '2026-04-23T00:00:00.000Z',
            recordCreatedAt: '2026-04-23T00:00:00.000Z',
            endedAt: null,
            durationMs: null,
            outcome: 'success',
            workflow: {
              id: 'wf-1',
              name: 'Workflow One',
              description: null,
              color: '#3972F6',
              folderId: null,
              folderName: null,
              userId: 'user-1',
              workspaceId: 'workspace-1',
              createdAt: '2026-04-23T00:00:00.000Z',
              updatedAt: '2026-04-23T00:00:00.000Z',
            },
          }}
          inspectorLoading={false}
          inspectorError={null}
          panelSizes={null}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onReloadViews={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Snapshot incomplete')
  })

  it('surfaces orphaned execution state in the inspector context strip', async () => {
    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId='log-1'
          selectedExecution={{
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
            isOrphaned: true,
            isPartial: false,
            sourceLog: {
              id: 'log-1',
              workspaceId: 'workspace-1',
              workflowId: 'wf-1',
              executionId: 'exec-1',
              level: 'info',
              trigger: 'manual',
              startedAt: '2026-04-23T00:00:00.000Z',
              recordCreatedAt: '2026-04-23T00:00:00.000Z',
              endedAt: '2026-04-23T00:05:00.000Z',
              durationMs: 300000,
              outcome: 'success',
              workflow: {
                id: 'wf-1',
                name: 'Workflow One',
                description: null,
                color: '#3972F6',
                folderId: null,
                folderName: null,
                userId: 'user-1',
                workspaceId: 'workspace-1',
                createdAt: '2026-04-23T00:00:00.000Z',
                updatedAt: '2026-04-23T00:00:00.000Z',
              },
            },
          }}
          selectedExecutionLog={{
            id: 'log-1',
            workspaceId: 'workspace-1',
            workflowId: 'wf-1',
            executionId: 'exec-1',
            level: 'info',
            trigger: 'manual',
            startedAt: '2026-04-23T00:00:00.000Z',
            recordCreatedAt: '2026-04-23T00:00:00.000Z',
            endedAt: '2026-04-23T00:05:00.000Z',
            durationMs: 300000,
            outcome: 'success',
            workflow: {
              id: 'wf-1',
              name: 'Workflow One',
              description: null,
              color: '#3972F6',
              folderId: null,
              folderName: null,
              userId: 'user-1',
              workspaceId: 'workspace-1',
              createdAt: '2026-04-23T00:00:00.000Z',
              updatedAt: '2026-04-23T00:00:00.000Z',
            },
          }}
          inspectorLoading={false}
          inspectorError={null}
          panelSizes={null}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onReloadViews={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Source monitor unavailable')
  })

  it('preserves the secondary sort when the primary sort field changes', async () => {
    const onUpdateViewConfig = vi.fn()

    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={{
            ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
            sortBy: [
              { field: 'startedAt', direction: 'desc' },
              { field: 'providerId', direction: 'asc' },
            ],
          }}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId={null}
          selectedExecution={null}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          panelSizes={null}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={onUpdateViewConfig}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onReloadViews={vi.fn()}
        />
      )
    })

    await selectOption('Started at ↓', 'Workflow ↓')

    const updater = onUpdateViewConfig.mock.calls.at(-1)?.[0]
    if (typeof updater !== 'function') {
      throw new Error('Expected sort field change to submit an updater')
    }

    expect(
      updater({
        ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        sortBy: [
          { field: 'startedAt', direction: 'desc' },
          { field: 'providerId', direction: 'asc' },
        ],
      }).sortBy
    ).toEqual([
      { field: 'workflowName', direction: 'desc' },
      { field: 'providerId', direction: 'asc' },
    ])
  })

  it('updates verticalGroupBy from the swimlane control in kanban mode', async () => {
    const onUpdateViewConfig = vi.fn()

    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId={null}
          selectedExecution={null}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          panelSizes={null}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={onUpdateViewConfig}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onReloadViews={vi.fn()}
        />
      )
    })

    await selectOption('Swimlane', 'Workflow')

    const updater = onUpdateViewConfig.mock.calls.at(-1)?.[0]
    if (typeof updater !== 'function') {
      throw new Error('Expected swimlane change to submit an updater')
    }

    expect(updater(DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG).verticalGroupBy).toBe('workflow')
  })

  it('shows GitHub-style timeline configuration controls in the view toolbar', async () => {
    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={{
            ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
            layout: 'timeline',
            groupBy: 'workflow',
            sliceBy: 'trigger',
            timeline: {
              ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.timeline,
              markers: {
                today: true,
                intervalBoundaries: false,
              },
              zoom: 'day',
              scale: 120,
            },
          }}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId={null}
          selectedExecution={null}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          panelSizes={null}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onReloadViews={vi.fn()}
        />
      )
    })

    const toolbar = container.querySelector('[role="toolbar"][aria-label="Monitor view controls"]')
    if (!(toolbar instanceof HTMLElement)) {
      throw new Error('Expected monitor view toolbar to render')
    }

    expect(toolbar.textContent).toContain('Group')
    expect(toolbar.textContent).toContain('Workflow')
    expect(toolbar.textContent).toContain('Markers')
    expect(toolbar.textContent).toContain('Today')
    expect(toolbar.textContent).toContain('Sort')
    expect(toolbar.textContent).toContain('Started at')
    expect(toolbar.textContent).not.toContain('Dates')
    expect(toolbar.textContent).not.toContain('Zoom level')
    expect(toolbar.textContent).not.toContain('120%')
    expect(toolbar.textContent).toContain('Slice')
    expect(toolbar.textContent).toContain('Trigger')
    expect(toolbar.textContent).toContain('Count')
    expect(toolbar.textContent).toContain('UTC')

    const rangeControls = container.querySelector(
      '[role="menubar"][aria-label="Timeline range controls"]'
    )
    if (!(rangeControls instanceof HTMLElement)) {
      throw new Error('Expected timeline range controls to render')
    }

    expect(rangeControls.textContent).toContain('Today')
    expect(rangeControls.textContent).toContain('Day')
    expect(rangeControls.textContent).toContain('Scale')
    expect(rangeControls.textContent).toContain('120%')
    expect(rangeControls.textContent).not.toContain('Markers')
    expect(rangeControls.querySelector('[role="slider"]')).toBeTruthy()
  })
})
