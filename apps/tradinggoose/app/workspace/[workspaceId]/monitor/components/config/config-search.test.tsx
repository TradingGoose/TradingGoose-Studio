/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorReferenceData } from '../shared/types'
import {
  type ConfigMonitorViewConfig,
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
} from '../view/view-config'
import { ConfigMonitorSearch } from './config-search'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const referenceData: MonitorReferenceData = {
  workflowTargets: [],
  workflowTargetByKey: {},
  workflowOptions: [],
  indicatorOptions: [{ id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' }],
  indicatorById: {
    rsi: { id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' },
  },
  streamingProviders: [
    { id: 'alpaca', name: 'Alpaca' },
    { id: 'finnhub', name: 'Finnhub' },
  ],
  providerById: {
    alpaca: { id: 'alpaca', name: 'Alpaca' },
    finnhub: { id: 'finnhub', name: 'Finnhub' },
  },
  providerIntervalsByProviderId: { alpaca: ['1m', '5m'], finnhub: ['1d'] },
  providerParamDefinitionsByProviderId: {},
  defaultDraftProviderId: 'alpaca',
  defaultDraftInterval: '1m',
  createDisabledReason: null,
  isLoading: false,
  warning: null,
}

function renderSearch({
  config = DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  onUpdateConfig = vi.fn(),
}: {
  config?: ConfigMonitorViewConfig
  onUpdateConfig?: (
    next: ConfigMonitorViewConfig | ((current: ConfigMonitorViewConfig) => ConfigMonitorViewConfig)
  ) => void
} = {}) {
  return (
    <ConfigMonitorSearch
      config={config}
      cards={[]}
      referenceData={referenceData}
      onUpdateConfig={onUpdateConfig}
    />
  )
}

describe('ConfigMonitorSearch', () => {
  let container: HTMLDivElement
  let root: Root

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

  it('keeps quick filter suggestions out of the page header until search focus', async () => {
    await act(async () => {
      root.render(renderSearch())
    })

    expect(container.querySelector('input[placeholder="Search config monitors..."]')).not.toBeNull()
    expect(container.textContent).not.toContain('Alpaca')
    expect(container.textContent).not.toContain('Active monitors')

    const input = container.querySelector('input')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Expected config search input')
    }

    await act(async () => {
      input.focus()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('Quick filters')
    expect(document.body.textContent).toContain('Alpaca')
  })

  it('stores selected suggestions as quick filters and clears partial search text', async () => {
    const onUpdateConfig = vi.fn()

    await act(async () => {
      root.render(renderSearch({ onUpdateConfig }))
    })

    const input = container.querySelector('input')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Expected config search input')
    }

    await act(async () => {
      input.focus()
      input.value = 'alp'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const alpacaButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Alpaca')
    )
    if (!(alpacaButton instanceof HTMLButtonElement)) {
      throw new Error('Expected Alpaca suggestion')
    }

    await act(async () => {
      alpacaButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await Promise.resolve()
    })

    const quickFilterUpdate = onUpdateConfig.mock.calls[0]?.[0]
    if (typeof quickFilterUpdate !== 'function') {
      throw new Error('Expected quick filter update')
    }

    expect(quickFilterUpdate(DEFAULT_CONFIG_MONITOR_VIEW_CONFIG).quickFilters).toEqual([
      { field: 'provider', operator: '=', values: ['alpaca'] },
    ])

    const rawQueryUpdate = onUpdateConfig.mock.calls[1]?.[0]
    if (typeof rawQueryUpdate !== 'function') {
      throw new Error('Expected raw query update')
    }
    expect(rawQueryUpdate(DEFAULT_CONFIG_MONITOR_VIEW_CONFIG).filterQuery).toBe('')
  })

  it('renders active quick filters as compact removable chips inside the search surface', async () => {
    const config = {
      ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      quickFilters: [{ field: 'provider', operator: '=', values: ['alpaca'] }],
    } satisfies ConfigMonitorViewConfig

    await act(async () => {
      root.render(renderSearch({ config }))
    })

    expect(container.textContent).toContain('Alpaca')
    expect(container.textContent).not.toContain('Finnhub')
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('')
  })
})
