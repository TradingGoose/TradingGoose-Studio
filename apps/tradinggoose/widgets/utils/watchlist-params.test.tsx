/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emitWatchlistParamsChange,
  sanitizeWatchlistParams,
  useWatchlistParamsPersistence,
} from '@/widgets/utils/watchlist-params'

function Harness({
  params,
  onWidgetParamsChange,
}: {
  params: Record<string, unknown> | null
  onWidgetParamsChange: (params: Record<string, unknown> | null) => void
}) {
  useWatchlistParamsPersistence({
    panelId: 'panel-1',
    widget: { key: 'watchlist' } as any,
    params,
    onWidgetParamsChange,
  })

  return null
}

describe('sanitizeWatchlistParams', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('preserves raw and env-var market auth', () => {
    expect(
      sanitizeWatchlistParams({
        provider: 'alpaca',
        watchlistId: 'watchlist-1',
        auth: {
          apiKey: 'raw-key',
          apiSecret: '{{ ALPACA_API_SECRET }}',
        },
      })
    ).toEqual({
      provider: 'alpaca',
      watchlistId: 'watchlist-1',
      auth: {
        apiKey: 'raw-key',
        apiSecret: '{{ ALPACA_API_SECRET }}',
      },
    })
  })

  it('merges runtime refresh updates against the latest sanitized params', async () => {
    const onWidgetParamsChange = vi.fn()

    await act(async () => {
      root.render(
        <Harness
          params={{
            provider: 'alpaca',
            runtime: {
              refreshAt: 100,
            },
          }}
          onWidgetParamsChange={onWidgetParamsChange}
        />
      )
    })

    await act(async () => {
      emitWatchlistParamsChange({
        params: {
          watchlistId: 'watchlist-1',
          runtime: {
            refreshAt: 200,
            ignored: 'value',
          },
          ignored: true,
        },
        panelId: 'panel-1',
        widgetKey: 'watchlist',
      })
    })

    expect(onWidgetParamsChange).toHaveBeenCalledWith({
      provider: 'alpaca',
      watchlistId: 'watchlist-1',
      runtime: {
        refreshAt: 200,
      },
    })

    await act(async () => {
      emitWatchlistParamsChange({
        params: {
          watchlistId: 'watchlist-1',
          runtime: {
            refreshAt: 200,
          },
        },
        panelId: 'panel-1',
        widgetKey: 'watchlist',
      })
    })

    expect(onWidgetParamsChange).toHaveBeenCalledTimes(1)
  })
})
