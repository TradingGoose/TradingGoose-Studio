/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
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
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.clearAllMocks()
  })

  it.each([true, false])('filters portfolio providers (Robinhood: %s)', async (available) => {
    fetchOAuthProviderAvailabilityMock.mockResolvedValue({
      'alpaca-paper': true,
      'tradier-live': false,
      robinhood: available,
    })
    const snapshots: MonitorReferenceData[] = []

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <Harness onRender={(referenceData) => snapshots.push(referenceData)} />
        </NextIntlClientProvider>
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchOAuthProviderAvailabilityMock).toHaveBeenCalledWith([
      'alpaca-live',
      'alpaca-paper',
      'tradier-live',
      'robinhood',
    ])
    expect(loadWorkflowTargetOptionsMock).toHaveBeenCalledWith('workspace-1', {
      workflowName: getPublicCopy('en').workspace.monitor.fields.workflow,
      triggerBlockNames: {
        indicator_trigger:
          getPublicCopy('en').workspace.widgets.blockEditor.blockNames.indicator_trigger,
        portfolio_state_trigger:
          getPublicCopy('en').workspace.widgets.blockEditor.blockNames.portfolio_state_trigger,
      },
    })
    expect(snapshots.at(-1)?.tradingProviders).toEqual([
      { id: 'alpaca', name: 'Alpaca' },
      ...(available ? [{ id: 'robinhood', name: 'Robinhood' }] : []),
    ])
    expect(snapshots.at(-1)?.tradingProviderById).toEqual({
      alpaca: { id: 'alpaca', name: 'Alpaca' },
      ...(available ? { robinhood: { id: 'robinhood', name: 'Robinhood' } } : {}),
    })
    expect(snapshots.at(-1)?.defaultPortfolioProviderId).toBe('alpaca')
    expect(snapshots.at(-1)?.createDisabledReason).toBeNull()
  })
})
