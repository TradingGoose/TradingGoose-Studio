/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorRecord, MonitorReferenceData } from '../shared/types'
import { DEFAULT_CONFIG_MONITOR_VIEW_CONFIG } from '../view/view-config'
import { useMonitorEditorState } from './use-monitor-editor-state'

const workflowTarget = {
  source: 'indicator',
  triggerId: 'indicator_trigger',
  workflowId: 'workflow-1',
  blockId: 'block-1',
  workflowName: 'Workflow One',
  workflowColor: '#3972F6',
  isDeployed: true,
  blockName: 'Indicator Trigger',
  label: 'Workflow One - Indicator Trigger',
} as const
const indicator = { id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' } as const
const referenceData: MonitorReferenceData = {
  workflowTargets: [workflowTarget],
  workflowTargetByKey: { 'workflow-1:block-1': workflowTarget },
  workflowOptions: [],
  indicatorWorkflowTargets: [workflowTarget],
  portfolioWorkflowTargets: [],
  indicatorOptions: [indicator],
  indicatorById: { rsi: indicator },
  marketProviders: [{ id: 'alpaca', name: 'Alpaca' }],
  marketProviderById: { alpaca: { id: 'alpaca', name: 'Alpaca' } },
  providerIntervalsByProviderId: { alpaca: ['1m'] },
  providerParamDefinitionsByProviderId: {
    alpaca: [
      { id: 'apiKey', type: 'string', title: 'API Key', required: true, password: true },
      { id: 'feed', type: 'string', title: 'Feed', required: true },
    ],
  },
  tradingProviders: [{ id: 'alpaca', name: 'Alpaca' }],
  tradingProviderById: { alpaca: { id: 'alpaca', name: 'Alpaca' } },
  defaultMarketProviderId: '',
  defaultPortfolioProviderId: '',
  defaultDraftInterval: '1m',
  createDisabledReason: null,
  isLoading: false,
  warning: null,
}

const monitor = {
  monitorId: 'monitor-1',
  source: 'indicator',
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
} satisfies MonitorRecord

const actions = {
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
  toggleMonitorState: vi.fn(),
  deleteMonitor: vi.fn(),
}

let editorState: ReturnType<typeof useMonitorEditorState>
const Harness = ({ records }: { records: MonitorRecord[] }) => {
  const state = useMonitorEditorState({
    workspaceId: 'workspace-1',
    monitorRecords: records,
    referenceData,
    monitorActions: actions,
    viewConfig: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
    onClearOperationMessage: vi.fn(),
  })
  editorState = state

  return (
    <div>
      <div data-testid='selected-monitor'>{state.selectedMonitorId ?? 'none'}</div>
      <button type='button' onClick={() => state.setSelectedMonitorId('monitor-1')}>
        Select monitor
      </button>
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

  it('only selects a monitor after an explicit selection', async () => {
    await act(async () => {
      root.render(<Harness records={[monitor]} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('none')

    const buttons = container.querySelectorAll('button')
    const selectButton = buttons[0]
    const clearButton = buttons[1]
    if (!(selectButton instanceof HTMLButtonElement)) {
      throw new Error('Expected select button to render')
    }
    if (!(clearButton instanceof HTMLButtonElement)) {
      throw new Error('Expected clear button to render')
    }

    await act(async () => {
      selectButton.click()
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('monitor-1')

    await act(async () => {
      clearButton.click()
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('none')

    await act(async () => {
      root.render(<Harness records={[monitor]} />)
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('none')
  })

  it('clears selection when the selected monitor is removed from records', async () => {
    await act(async () => {
      root.render(<Harness records={[monitor]} />)
    })

    const selectButton = container.querySelector('button')
    if (!(selectButton instanceof HTMLButtonElement)) {
      throw new Error('Expected select button to render')
    }

    await act(async () => {
      selectButton.click()
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('monitor-1')

    await act(async () => {
      root.render(<Harness records={[]} />)
      await Promise.resolve()
    })

    expect(selectedMonitorText()).toBe('none')
  })

  it('keeps current validation derived while preserving unrelated proposal issues', async () => {
    actions.updateMonitor.mockResolvedValueOnce(monitor)
    await act(async () => root.render(<Harness records={[monitor]} />))
    await act(async () =>
      editorState.openRejectedDropProposal(monitor, {
        draftPatch: {},
        proposalIssues: { listing: ['Dropped listing is unavailable.'] },
        showValidationIssues: true,
      })
    )
    expect(editorState.editingIssues).toHaveProperty('secret:apiKey')
    expect(editorState.editingIssues).toHaveProperty('param:feed')
    expect(editorState.editingIssues.listing).toEqual(['Dropped listing is unavailable.'])

    await act(async () => editorState.updateSecretValue('apiKey', 'secret'))
    expect(editorState.editingIssues).not.toHaveProperty('secret:apiKey')
    expect(editorState.editingIssues).toHaveProperty('param:feed')
    await act(async () => editorState.updateProviderParamValue('feed', 'sip'))
    expect(editorState.editingIssues).not.toHaveProperty('param:feed')
    expect(editorState.editingIssues).toHaveProperty('listing')

    await act(async () =>
      editorState.updateDraft({
        listing: { listing_type: 'default', listing_id: 'MSFT', base_id: '', quote_id: '' },
      })
    )
    expect(editorState.editingIssues).not.toHaveProperty('listing')
    await act(async () => editorState.persistDraft())
    expect(actions.updateMonitor).toHaveBeenCalledTimes(1)
  })
})
