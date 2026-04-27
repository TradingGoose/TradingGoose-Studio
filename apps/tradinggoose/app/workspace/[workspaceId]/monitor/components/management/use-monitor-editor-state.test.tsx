/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndicatorMonitorRecord, MonitorReferenceData } from '../shared/types'
import { DEFAULT_CONFIG_MONITOR_VIEW_CONFIG } from '../view/view-config'
import { useMonitorEditorState } from './use-monitor-editor-state'

const referenceData: MonitorReferenceData = {
  workflowTargets: [],
  workflowTargetByKey: {},
  workflowOptions: [],
  indicatorOptions: [],
  indicatorById: {},
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

const actions = {
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
  toggleMonitorState: vi.fn(),
  deleteMonitor: vi.fn(),
}

const Harness = ({ records }: { records: IndicatorMonitorRecord[] }) => {
  const state = useMonitorEditorState({
    workspaceId: 'workspace-1',
    monitorRecords: records,
    referenceData,
    monitorActions: actions,
    viewConfig: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  })

  return (
    <div>
      <div data-testid='selected-monitor'>{state.selectedMonitorId ?? 'none'}</div>
      <button type='button' onClick={state.clearSelection}>
        Clear selection
      </button>
    </div>
  )
}

describe('useMonitorEditorState', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.clearAllMocks()
  })

  const selectedMonitorText = () =>
    container.querySelector('[data-testid="selected-monitor"]')?.textContent

  it('does not immediately reselect a monitor after an explicit clear', async () => {
    await act(async () => {
      root.render(<Harness records={[monitor]} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('monitor-1')

    const button = container.querySelector('button')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected clear button to render')
    }

    await act(async () => {
      button.click()
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('none')

    await act(async () => {
      root.render(<Harness records={[monitor]} />)
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('none')
  })
})
