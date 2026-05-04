/**
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emitDataChartParamsChange,
  sanitizeDataChartParams,
  useDataChartParamsPersistence,
} from '@/widgets/utils/chart-params'

function Harness({
  params,
  onWidgetParamsChange,
}: {
  params: Record<string, unknown> | null
  onWidgetParamsChange: (params: Record<string, unknown> | null) => void
}) {
  useDataChartParamsPersistence({
    panelId: 'panel-1',
    widget: { key: 'data_chart' } as any,
    params,
    onWidgetParamsChange,
  })

  return null
}

describe('sanitizeDataChartParams', () => {
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

  it('preserves raw and env-var nested market auth for data chart provider params', () => {
    expect(
      sanitizeDataChartParams({
        data: {
          provider: 'alpaca',
          auth: {
            apiKey: 'raw-key',
            apiSecret: '{{ ALPACA_API_SECRET }}',
          },
        },
      })
    ).toEqual({
      data: {
        provider: 'alpaca',
        auth: {
          apiKey: 'raw-key',
          apiSecret: '{{ ALPACA_API_SECRET }}',
        },
      },
    })
  })

  it('uses sanitized params as the persistence comparison baseline', async () => {
    const onWidgetParamsChange = vi.fn()

    await act(async () => {
      root.render(
        createElement(Harness, {
          params: {
            data: {
              provider: 'alpaca',
              auth: {
                apiKey: 'raw-key',
              },
            },
          },
          onWidgetParamsChange,
        })
      )
    })

    await act(async () => {
      emitDataChartParamsChange({
        params: {
          data: {
            provider: 'alpaca',
          },
        },
        panelId: 'panel-1',
        widgetKey: 'data_chart',
      })
    })

    expect(onWidgetParamsChange).not.toHaveBeenCalled()
  })
})
