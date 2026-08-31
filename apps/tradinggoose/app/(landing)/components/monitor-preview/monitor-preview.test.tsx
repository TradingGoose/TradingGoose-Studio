/**
 * @vitest-environment jsdom
 */

import type { HTMLAttributes, ReactNode } from 'react'
import { act, StrictMode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingResolved } from '@/lib/listing/identity'
import { getPublicCopy } from '@/i18n/public-copy'
import MonitorPreview from './monitor-preview'

vi.mock('@/components/listing-selector/listing/row', () => ({
  MarketListingRow: ({ listing }: { listing: ListingResolved }) => <span>{listing.base}</span>,
}))

type MotionRowProps = HTMLAttributes<HTMLTableRowElement> & {
  animate?: unknown
  initial?: unknown
  transition?: unknown
}

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    tr: ({
      animate: _animate,
      initial: _initial,
      transition: _transition,
      ...props
    }: MotionRowProps) => <tr {...props} />,
  },
}))

const stock: ListingResolved = {
  listingIdentity: {
    listing_id: 'AAPL',
    base_id: '',
    quote_id: '',
    listing_type: 'default',
  },
  base: 'AAPL',
  name: 'Apple Inc.',
}

describe('MonitorPreview', () => {
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
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('keeps row keys unique when multiple ticks occur at the same wall-clock time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_787_073_647_436)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const randomUUID = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await act(async () => {
      root.render(
        <StrictMode>
          <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
            <MonitorPreview stocks={[stock]} />
          </NextIntlClientProvider>
        </StrictMode>
      )
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(randomUUID).toHaveBeenCalledTimes(2)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(
      consoleError.mock.calls.filter(([message]) =>
        String(message).includes('Encountered two children with the same key')
      )
    ).toHaveLength(0)
  })
})
