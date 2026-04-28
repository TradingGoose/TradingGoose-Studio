/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndicatorMonitorRecord, MonitorReferenceData } from '../shared/types'
import { DEFAULT_CONFIG_MONITOR_VIEW_CONFIG } from '../view/view-config'
import { MonitorConfigWorkspace } from './monitor-config-workspace'

vi.mock('../data/use-monitor-execution-summaries', () => ({
  useMonitorExecutionSummaries: () => ({
    summariesByMonitorId: {},
    isLoading: false,
    isFetching: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const referenceData: MonitorReferenceData = {
  workflowTargets: [
    {
      workflowId: 'workflow-1',
      blockId: 'block-1',
      workflowName: 'Workflow One',
      workflowColor: '#3972F6',
      isDeployed: true,
      blockName: 'Indicator Trigger',
      label: 'Workflow One - Indicator Trigger',
    },
  ],
  workflowTargetByKey: {
    'workflow-1:block-1': {
      workflowId: 'workflow-1',
      blockId: 'block-1',
      workflowName: 'Workflow One',
      workflowColor: '#3972F6',
      isDeployed: true,
      blockName: 'Indicator Trigger',
      label: 'Workflow One - Indicator Trigger',
    },
  },
  workflowOptions: [],
  indicatorOptions: [{ id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' }],
  indicatorById: {
    rsi: { id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' },
  },
  streamingProviders: [{ id: 'alpaca', name: 'Alpaca' }],
  providerById: { alpaca: { id: 'alpaca', name: 'Alpaca' } },
  providerIntervalsByProviderId: { alpaca: ['1m'] },
  providerParamDefinitionsByProviderId: {},
  defaultDraftProviderId: 'alpaca',
  defaultDraftInterval: '1m',
  createDisabledReason: null,
  isLoading: false,
  warning: null,
}

const monitor = {
  monitorId: 'monitor-1',
  workflowId: 'workflow-1',
  blockId: 'block-1',
  isActive: true,
  providerConfig: {
    triggerId: 'indicator_trigger',
    version: 1,
    monitor: {
      providerId: 'alpaca',
      interval: '1m',
      listing: { listing_type: 'default', listing_id: 'AAPL', base_id: '', quote_id: '' },
      indicatorId: 'rsi',
    },
  },
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
} satisfies IndicatorMonitorRecord

describe('MonitorConfigWorkspace', () => {
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
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders config cards from monitor records and opens create from a board add action', async () => {
    await act(async () => {
      root.render(
        <MonitorConfigWorkspace
          workspaceId='workspace-1'
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={DEFAULT_CONFIG_MONITOR_VIEW_CONFIG}
          panelSizes={null}
          monitorRecords={[monitor]}
          monitorsLoading={false}
          monitorsError={null}
          referenceData={referenceData}
          monitorActions={{
            createMonitor: vi.fn(),
            updateMonitor: vi.fn(),
            toggleMonitorState: vi.fn(),
            deleteMonitor: vi.fn(),
          }}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onReloadViews={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('RSI')
    expect(container.textContent).toContain('Workflow One - Indicator Trigger')

    const addMonitorButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.getAttribute('aria-label')?.includes('Add monitor')
    )
    if (!(addMonitorButton instanceof HTMLButtonElement)) {
      throw new Error('Expected Add monitor button to render')
    }

    await act(async () => {
      addMonitorButton.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Create Monitor')
  })

  it('keeps the detail panel closed until a monitor card is selected', async () => {
    await act(async () => {
      root.render(
        <MonitorConfigWorkspace
          workspaceId='workspace-1'
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={DEFAULT_CONFIG_MONITOR_VIEW_CONFIG}
          panelSizes={null}
          monitorRecords={[monitor]}
          monitorsLoading={false}
          monitorsError={null}
          referenceData={referenceData}
          monitorActions={{
            createMonitor: vi.fn(),
            updateMonitor: vi.fn(),
            toggleMonitorState: vi.fn(),
            deleteMonitor: vi.fn(),
          }}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onReloadViews={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('RSI')
    expect(container.textContent).not.toContain('Monitor ID')
    expect(container.textContent).not.toContain('Delete')

    const monitorCard = Array.from(container.querySelectorAll('[role="button"]')).find((node) =>
      node.textContent?.includes('RSI')
    )
    if (!(monitorCard instanceof HTMLElement)) {
      throw new Error('Expected monitor card to render')
    }

    await act(async () => {
      monitorCard.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Monitor ID')
    expect(container.textContent).toContain('Delete')
    expect(container.textContent).toContain('Workflow One - Indicator Trigger')
  })

  it('surfaces non-fatal view warnings while rendering server-backed config views', async () => {
    await act(async () => {
      root.render(
        <MonitorConfigWorkspace
          workspaceId='workspace-1'
          viewStateMode='server'
          viewStateReloading={false}
          viewsError='Execution views are unavailable.'
          effectiveConfig={DEFAULT_CONFIG_MONITOR_VIEW_CONFIG}
          panelSizes={null}
          monitorRecords={[monitor]}
          monitorsLoading={false}
          monitorsError={null}
          referenceData={referenceData}
          monitorActions={{
            createMonitor: vi.fn(),
            updateMonitor: vi.fn(),
            toggleMonitorState: vi.fn(),
            deleteMonitor: vi.fn(),
          }}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onReloadViews={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Execution views are unavailable.')
    expect(container.textContent).toContain('RSI')
  })

  it('renders empty config kanban lanes instead of a blank board', async () => {
    await act(async () => {
      root.render(
        <MonitorConfigWorkspace
          workspaceId='workspace-1'
          viewStateMode='server'
          viewStateReloading={false}
          viewsError={null}
          effectiveConfig={DEFAULT_CONFIG_MONITOR_VIEW_CONFIG}
          panelSizes={null}
          monitorRecords={[]}
          monitorsLoading={false}
          monitorsError={null}
          referenceData={{
            ...referenceData,
            workflowTargets: [],
            workflowTargetByKey: {},
          }}
          monitorActions={{
            createMonitor: vi.fn(),
            updateMonitor: vi.fn(),
            toggleMonitorState: vi.fn(),
            deleteMonitor: vi.fn(),
          }}
          onPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onReloadViews={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('All monitors')
    expect(container.textContent).toContain('Workflow target')
    expect(container.textContent).toContain('Active')
    expect(container.textContent).toContain('Paused')
    expect(container.querySelector('button[aria-label^="Add monitor"]')).not.toBeNull()
  })
})
