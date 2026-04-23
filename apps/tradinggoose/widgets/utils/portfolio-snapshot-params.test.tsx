/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emitPortfolioSnapshotParamsChange,
  sanitizePortfolioSnapshotParams,
  usePortfolioSnapshotParamsPersistence,
} from '@/widgets/utils/portfolio-snapshot-params'

function Harness({
  params,
  onWidgetParamsChange,
}: {
  params: Record<string, unknown> | null
  onWidgetParamsChange: (params: Record<string, unknown> | null) => void
}) {
  usePortfolioSnapshotParamsPersistence({
    panelId: 'panel-1',
    widget: { key: 'portfolio_snapshot' } as any,
    params,
    onWidgetParamsChange,
  })

  return null
}

describe('portfolio snapshot params helper', () => {
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
    vi.restoreAllMocks()
  })

  it('sanitizes the persisted shape down to supported keys', () => {
    expect(
      sanitizePortfolioSnapshotParams({
        provider: 'alpaca',
        credentialId: 'cred-1',
        selectedWindow: '1D',
        ignored: true,
        runtime: {
          refreshAt: 123,
          ignored: 'x',
        },
      })
    ).toEqual({
      provider: 'alpaca',
      credentialId: 'cred-1',
      selectedWindow: '1D',
      runtime: {
        refreshAt: 123,
      },
    })
  })

  it('merges runtime.refreshAt updates without keeping unsupported keys', async () => {
    const onWidgetParamsChange = vi.fn()

    await act(async () => {
      root.render(
        <Harness
          params={{
            provider: 'alpaca',
            environment: 'paper',
            runtime: {
              refreshAt: 100,
            },
          }}
          onWidgetParamsChange={onWidgetParamsChange}
        />
      )
    })

    await act(async () => {
      emitPortfolioSnapshotParamsChange({
        params: {
          credentialId: 'cred-1',
          runtime: {
            refreshAt: 200,
            ignored: 'value',
          },
          ignored: true,
        },
        panelId: 'panel-1',
        widgetKey: 'portfolio_snapshot',
      })
    })

    expect(onWidgetParamsChange).toHaveBeenCalledWith({
      provider: 'alpaca',
      environment: 'paper',
      credentialId: 'cred-1',
      runtime: {
        refreshAt: 200,
      },
    })
  })
})
