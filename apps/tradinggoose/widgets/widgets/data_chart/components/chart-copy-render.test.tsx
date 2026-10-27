/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  readDashboardWidgetDocument,
  seedDashboardWidgetSession,
} from '@/lib/yjs/dashboard-layout-session'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { LocalWidgetConfigRuntimeProvider } from '@/widgets/widget-config-runtime'
import { IndicatorDropdown } from '@/widgets/widgets/components/pine-indicator-dropdown'
import { DataChartCandleTypeDropdown, DataChartIntervalDropdown } from './chart-controls'
import { DataChartFooter } from './footer'
import { IndicatorControl } from './indicator-control'

vi.mock('@/components/timezone-selector/fetchers', () => ({
  fetchTimeZoneOptions: vi.fn(async () => []),
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({
    members: [{ entityId: 'custom-1', entityName: 'Custom indicator', color: '#737373' }],
    isLoading: false,
    error: null,
  }),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const dispatchMouse = (target: Element, ...types: string[]) =>
  act(async () => {
    for (const type of types)
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('data chart localized component copy', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    doc = new Y.Doc()
    seedDashboardWidgetSession(doc, { pairColor: 'gray', params: null })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    doc.destroy()
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderWithLocale = (element: React.ReactNode, locale: LocaleCode = 'es') => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
        <TooltipProvider>
          <LocalWidgetConfigRuntimeProvider doc={doc} widgetKey='data_chart'>
            {element}
          </LocalWidgetConfigRuntimeProvider>
        </TooltipProvider>
      </NextIntlClientProvider>
    )
  }

  it('renders chart control labels in the active locale', async () => {
    await act(async () => {
      renderWithLocale(
        <DataChartCandleTypeDropdown params={{ view: { candleType: 'area' } }} candleType='area' />
      )
    })

    expect(container.textContent).toContain('Estilo de vela')
  })

  it('renders footer labels in the active locale', async () => {
    await act(async () => {
      renderWithLocale(
        <DataChartFooter
          params={{ data: { provider: 'yahoo-finance' }, view: { rangePresetId: 'all' } }}
        />
      )
    })

    expect(container.textContent).toContain('Todo')
    expect(container.getAttribute('aria-label')).toBeNull()
    expect(container.querySelector('[aria-label="Pie del widget"]')).toBeTruthy()
  })

  it.each(['alpaca', 'robinhood', 'unknown'])(
    'omits All when %s cannot fetch complete history',
    async (provider) => {
      await act(async () => {
        renderWithLocale(<DataChartFooter params={{ data: { provider } }} />, 'en')
      })
      expect(container.textContent).not.toContain('ALL')
    }
  )

  it.each([
    ['yahoo-finance', '3m', '1d', true],
    ['alpha-vantage', '3m', '1d', true],
    ['yahoo-finance', '3m', undefined, true],
    ['alpha-vantage', '3m', undefined, true],
    ['yahoo-finance', '3m', '1h', false],
    ['alpha-vantage', '3m', '1h', false],
    ['yahoo-finance', '1d', '1mo', false],
  ] as const)(
    'validates the active %s %s footer range at %s',
    async (provider, rangePresetId, interval, valid) => {
      await act(async () => {
        renderWithLocale(
          <DataChartFooter params={{ data: { provider }, view: { rangePresetId, interval } }} />,
          'en'
        )
      })
      const labels = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)
      expect(labels).toContain('1D')
      expect(labels.includes('3M')).toBe(valid)
      expect(
        container.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null
      ).toBe(valid ? '3M' : null)
      if (valid) expect(labels).toEqual(['1D', '5D', '1M', '3M', '1Y', '5Y', 'ALL'])
    }
  )

  it.each(['interval', 'range'])(
    'clears the previous viewport when selecting a new %s',
    async (control) => {
      const params = {
        data: { provider: 'yahoo-finance' },
        view: {
          interval: control === 'range' ? '3mo' : '1d',
          rangePresetId: control === 'range' ? 'all' : '1y',
          start: 1,
          end: 2,
          candleType: 'area' as const,
        },
      }
      seedDashboardWidgetSession(doc, { pairColor: 'gray', params })
      await act(async () => {
        renderWithLocale(
          control === 'interval' ? (
            <DataChartIntervalDropdown interval='1d' allowedIntervals={['1h']} supportsInterval />
          ) : (
            <DataChartFooter params={params} />
          ),
          'en'
        )
      })
      if (control === 'interval') {
        await dispatchMouse(
          container.querySelector('button[aria-expanded]')!,
          'mousedown',
          'mouseup',
          'click'
        )
        await dispatchMouse(document.querySelector('[role="menuitem"]')!, 'click')
      } else {
        await dispatchMouse(
          container.querySelector('[role="tab"]')!,
          'mousedown',
          'mouseup',
          'click'
        )
      }
      expect(readDashboardWidgetDocument(doc, 'data_chart').params?.view).toEqual({
        interval: control === 'interval' ? '1h' : '1m',
        ...(control === 'range' ? { rangePresetId: '1d' } : {}),
        candleType: 'area',
      })
    }
  )

  it('renders indicator control labels in the active locale', async () => {
    await act(async () => {
      renderWithLocale(
        <IndicatorControl
          indicatorId='RSI'
          name='Índice de fuerza relativa'
          isHidden={false}
          executionFailure='compile failed'
          onToggleHidden={vi.fn()}
          onRemove={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Error del indicador')
  })

  it('keeps the indicator chooser open through its complete trigger click', async () => {
    await act(() => renderWithLocale(<IndicatorDropdown workspaceId='workspace-1' />))

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-expanded]')
    const input = container.querySelector<HTMLInputElement>('input')
    if (!trigger || !input) throw new Error('Expected indicator chooser controls to render')

    await dispatchMouse(trigger, 'mousedown')
    await dispatchMouse(trigger, 'mouseup', 'click')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveFocus()

    await dispatchMouse(input, 'mousedown', 'click')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await dispatchMouse(trigger, 'click')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
