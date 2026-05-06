/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ConfigMonitorViewConfig,
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
} from '../view/view-config'
import { useConfigSearchState } from './config-search-state'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

function Harness({
  config,
  onUpdateConfig = vi.fn(),
}: {
  config: ConfigMonitorViewConfig
  onUpdateConfig?: (
    next: ConfigMonitorViewConfig | ((current: ConfigMonitorViewConfig) => ConfigMonitorViewConfig)
  ) => void
}) {
  const searchState = useConfigSearchState({ config, onUpdateConfig })
  return <div data-testid='raw-query'>{searchState.rawQuery}</div>
}

describe('useConfigSearchState', () => {
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
  })

  it('resyncs the raw query when the active config view query changes', async () => {
    await act(async () => {
      root.render(
        <Harness
          config={{
            ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
            filterQuery: 'provider:alpaca',
          }}
        />
      )
    })

    expect(container.textContent).toBe('provider:alpaca')

    await act(async () => {
      root.render(
        <Harness
          config={{
            ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
            filterQuery: 'status:paused',
          }}
        />
      )
    })

    expect(container.textContent).toBe('status:paused')
  })
})
