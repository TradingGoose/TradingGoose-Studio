import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ money: vi.fn((_: unknown, value: string) => `USD(${value})`) }))
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: any) => values?.cost ?? key,
}))
vi.mock('@/i18n/formatters', () => ({
  formatUsd: mocks.money,
  formatLocalizedNumber: (_locale: string, value: number) => String(value),
}))
vi.mock('@/components/ui/dialog', () => {
  const children = ({ children }: any) => children
  return {
    Dialog: children,
    DialogContent: children,
    DialogDescription: children,
    DialogFooter: children,
    DialogHeader: children,
    DialogTitle: children,
  }
})
vi.mock('@/components/ui/tooltip', () => {
  const children = ({ children }: any) => children
  return {
    Tooltip: children,
    TooltipContent: children,
    TooltipProvider: children,
    TooltipTrigger: ({ render, children }: any) => render ?? children,
  }
})
vi.mock('@/components/ui/button', async () => {
  const { createElement } = await import('react')
  return {
    Button: ({ children, disabled }: any) => createElement('button', { disabled }, children),
  }
})

import { TeamSeats } from './team-seats'

const props = {
  open: true,
  onOpenChange: vi.fn(),
  title: 'Seats',
  description: 'Price',
  pricePerSeat: '0.10000000000000001',
  minimumSeats: 1,
  maximumSeats: null,
  initialSeats: 3,
  currentSeats: 5,
  isLoading: false,
  onConfirm: vi.fn(),
  confirmButtonText: 'Confirm',
  showCostBreakdown: true,
}
beforeEach(() => mocks.money.mockClear())
describe('team seat exact pricing display', () => {
  it('multiplies integer quantities exactly and represents reduction sign separately from nonnegative money', () => {
    const html = renderToStaticMarkup(createElement(TeamSeats, props))
    expect(mocks.money).toHaveBeenCalledWith('en', '0.30000000000000003')
    expect(mocks.money).toHaveBeenCalledWith('en', '0.20000000000000002')
    expect(html).toContain('−USD(0.20000000000000002)')
  })
  it('keeps unavailable price unknown and disables price-dependent confirmation', () => {
    const html = renderToStaticMarkup(createElement(TeamSeats, { ...props, pricePerSeat: null }))
    expect(mocks.money).not.toHaveBeenCalled()
    expect(html).toContain('—')
    expect(html).toMatch(/<button disabled="">[\s\S]*?Confirm[\s\S]*?<\/button>/)
  })
  it('rejects unsafe integer quantities before any monetary conversion', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(TeamSeats, { ...props, initialSeats: Number.MAX_SAFE_INTEGER + 1 })
      )
    ).toThrow('safe integer')
  })
})
