/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { useLocaleMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'zh-CN'),
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode; href: string }) => {
    const locale = useLocaleMock()
    const localePrefix = locale === 'zh-CN' ? '/zh' : `/${locale}`
    const localizedHref =
      !href.startsWith('/') || href.startsWith(localePrefix) || locale === 'en'
        ? href
        : `${localePrefix}${href}`

    return (
      <a href={localizedHref} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('../page-shell', () => ({
  AdminPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('AdminBillingUnavailable', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useLocaleMock.mockReturnValue('zh-CN')
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  it('localizes the back link', async () => {
    const { AdminBillingUnavailable } = await import('./billing-unavailable')

    await act(async () => {
      root.render(
        <AdminBillingUnavailable title='Billing unavailable' description='Disabled' />
      )
    })

    expect(container.querySelector('a[href="/zh/admin"]')).not.toBeNull()
  })
})
