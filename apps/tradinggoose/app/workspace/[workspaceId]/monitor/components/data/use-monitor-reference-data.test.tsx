/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorReferenceData } from '../shared/types'

const {
  loadIndicatorOptionsMock,
  loadWorkflowOptionsMock,
  loadWorkflowTargetOptionsMock,
  fetchOAuthProviderAvailabilityMock,
} = vi.hoisted(() => ({
  loadIndicatorOptionsMock: vi.fn(),
  loadWorkflowOptionsMock: vi.fn(),
  loadWorkflowTargetOptionsMock: vi.fn(),
  fetchOAuthProviderAvailabilityMock: vi.fn(),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  fetchOAuthProviderAvailability: fetchOAuthProviderAvailabilityMock,
}))

vi.mock('./api', () => ({
  loadIndicatorOptions: loadIndicatorOptionsMock,
  loadWorkflowOptions: loadWorkflowOptionsMock,
  loadWorkflowTargetOptions: loadWorkflowTargetOptionsMock,
}))

import { useMonitorReferenceData } from './use-monitor-reference-data'

function Harness({
  onRender,
  workspaceId = 'workspace-1',
}: {
  onRender: (referenceData: MonitorReferenceData) => void
  workspaceId?: string
}) {
  onRender(useMonitorReferenceData(workspaceId))
  return null
}

describe('useMonitorReferenceData', () => {
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
    loadIndicatorOptionsMock.mockResolvedValue([
      { id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' },
    ])
    loadWorkflowOptionsMock.mockResolvedValue([])
    loadWorkflowTargetOptionsMock.mockResolvedValue([
      {
        source: 'portfolio',
        triggerId: 'portfolio_state_trigger',
        workflowId: 'workflow-1',
        blockId: 'portfolio-trigger',
        workflowName: 'Portfolio Workflow',
        workflowColor: '#3972F6',
        isDeployed: true,
        blockName: 'Portfolio Trigger',
        label: 'Portfolio Workflow - Portfolio Trigger',
      },
    ])
    fetchOAuthProviderAvailabilityMock.mockResolvedValue({
      'alpaca-paper': true,
      'tradier-live': false,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.clearAllMocks()
  })

  it('uses canonical OAuth service availability for portfolio monitor provider options', async () => {
    const snapshots: MonitorReferenceData[] = []

    await act(async () => {
      root.render(<Harness onRender={(referenceData) => snapshots.push(referenceData)} />)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchOAuthProviderAvailabilityMock).toHaveBeenCalledWith([
      'alpaca-live',
      'alpaca-paper',
      'tradier-live',
    ])
    expect(snapshots.at(-1)?.tradingProviders).toEqual([{ id: 'alpaca', name: 'Alpaca' }])
    expect(snapshots.at(-1)?.tradingProviderById).toEqual({
      alpaca: { id: 'alpaca', name: 'Alpaca' },
    })
    expect(snapshots.at(-1)?.defaultPortfolioProviderId).toBe('alpaca')
    expect(snapshots.at(-1)?.createDisabledReason).toBeNull()
  })
})
