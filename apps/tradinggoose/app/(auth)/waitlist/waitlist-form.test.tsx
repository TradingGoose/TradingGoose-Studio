/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { WaitlistForm } from './waitlist-form'

vi.mock('@/app/fonts/inter', () => ({
  inter: { className: '' },
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: React.ReactNode
    href: string
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('WaitlistForm', () => {
  let container: HTMLDivElement
  let root: Root
  const originalFetch = globalThis.fetch
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount()
      })
    }
    container?.remove()
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('preserves the disabled registration error returned by the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'REGISTRATION_DISABLED' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <WaitlistForm />
        </NextIntlClientProvider>
      )
    })

    const input = container.querySelector('#waitlist-email')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Expected waitlist input to render')
    }

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, 'user@example.com')

    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const form = container.querySelector('form')
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('Expected waitlist form to render')
    }

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(getPublicCopy('en').auth.disabled.description)
  })

  it('falls back to the generic rejected copy for non-specific failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'UNEXPECTED_FAILURE' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <WaitlistForm />
        </NextIntlClientProvider>
      )
    })

    const input = container.querySelector('#waitlist-email')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Expected waitlist input to render')
    }

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, 'user@example.com')

    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const form = container.querySelector('form')
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('Expected waitlist form to render')
    }

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(getPublicCopy('en').auth.waitlist.rejected)
  })
})
