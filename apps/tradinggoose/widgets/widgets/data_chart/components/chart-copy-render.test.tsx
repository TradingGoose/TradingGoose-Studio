/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getPublicCopy } from '@/i18n/public-copy'
import { DataChartCandleTypeDropdown } from './chart-controls'
import { DataChartFooter } from './footer'
import { IndicatorControl } from './indicator-control'

vi.mock('@/components/timezone-selector/fetchers', () => ({
  fetchTimeZoneOptions: vi.fn(async () => []),
  formatTimezoneLabel: (value: string) => value,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('data chart localized component copy', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderWithLocale = (element: React.ReactNode, locale = 'es') => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
        <TooltipProvider>{element}</TooltipProvider>
      </NextIntlClientProvider>
    )
  }

  it('renders chart control labels in the active locale', async () => {
    await act(async () => {
      renderWithLocale(
        <DataChartCandleTypeDropdown
          params={{ view: { candleType: 'area' } }}
          candleType='area'
        />
      )
    })

    expect(container.textContent).toContain('Estilo de vela')
  })

  it('renders footer labels in the active locale', async () => {
    await act(async () => {
      renderWithLocale(
        <DataChartFooter
          params={{ view: { rangePresetId: 'all' } }}
          allowedIntervals={['1m', '1d', '1mo']}
        />
      )
    })

    expect(container.textContent).toContain('Todo')
    expect(container.getAttribute('aria-label')).toBeNull()
    expect(container.querySelector('[aria-label="Pie del widget"]')).toBeTruthy()
  })

  it('renders indicator control labels in the active locale', async () => {
    await act(async () => {
      renderWithLocale(
        <IndicatorControl
          indicatorId='RSI'
          name='Índice de fuerza relativa'
          isHidden={false}
          errorMessage='compile failed'
          onToggleHidden={vi.fn()}
          onRemove={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Error del indicador')
  })
})
