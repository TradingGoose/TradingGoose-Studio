/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { Notebook, Waypoints } from 'lucide-react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { getPublicCopy } from '@/i18n/public-copy'
import { localizeDocsUrl } from '@/i18n/utils'
import type { NavSection } from '../types'
import { SidebarNav } from './sidebar-nav'

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    children?: React.ReactNode
    href: string | { pathname?: string }
    prefetch?: boolean
  }) => (
    <a href={typeof href === 'string' ? href : (href.pathname ?? '')} {...props}>
      {children}
    </a>
  ),
}))

const matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

describe('SidebarNav', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const originalMatchMedia = window.matchMedia
  const originalInnerWidth = window.innerWidth

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    window.matchMedia = matchMedia
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
      writable: true,
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    window.matchMedia = originalMatchMedia
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
      writable: true,
    })
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('adds the localized docs link after integrations in the more section', async () => {
    const navItems: NavSection[] = [
      {
        key: 'usage',
        title: 'Usage',
        url: '/workspace/demo/usage',
        icon: Notebook,
        section: 'workspace',
      },
      {
        key: 'integrations',
        title: 'Integrations',
        url: '/workspace/demo/integrations',
        icon: Waypoints,
        section: 'more',
      },
    ]
    const docsLabel = getPublicCopy('es').nav.docs

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='es' messages={getPublicCopy('es')}>
          <SidebarProvider>
            <SidebarNav navItems={navItems} />
          </SidebarProvider>
        </NextIntlClientProvider>
      )
    })

    const links = Array.from(container.querySelectorAll('a'))
    const docsLink = links.find((link) => link.textContent?.includes(docsLabel))

    if (!(docsLink instanceof HTMLAnchorElement)) {
      throw new Error('Expected localized documentation link to render')
    }

    expect(docsLink.getAttribute('href')).toBe(localizeDocsUrl('es'))
    expect(links.map((link) => link.textContent?.trim())).toContain(docsLabel)
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Usage',
      'Integrations',
      docsLabel,
    ])
  })
})
