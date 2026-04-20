/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import Nav from './nav'
import PublicNav from './public-nav'

const mockPush = vi.fn()

vi.mock('@/lib/registration/service', () => ({
  getRegistrationModeForRender: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('next/image', () => ({
  default: ({
    alt,
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    <img alt={alt ?? ''} {...props} />
  ),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: React.ReactNode
    href: string
    prefetch?: boolean
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/app/fonts/soehne/soehne', () => ({
  soehne: { className: '' },
}))

vi.mock('@/app/(landing)/actions/github', () => ({
  getFormattedGitHubStars: vi.fn(async () => '0'),
}))

vi.mock('@/lib/branding/branding', () => ({
  useBrandConfig: () => ({
    name: 'TradingGoose',
  }),
}))

describe('landing nav registration mode', () => {
  let container: HTMLDivElement
  let root: Root

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mockPush.mockReset()
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('uses the shared landing nav for public pages via PublicNav', async () => {
    vi.mocked(getRegistrationModeForRender).mockResolvedValue('waitlist')

    await act(async () => {
      root.render(await PublicNav())
    })

    expect(getRegistrationModeForRender).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Docs')
    expect(container.textContent).toContain('Blog')
    expect(container.textContent).toContain('Login')
    expect(container.textContent).toContain('Join Waitlist')
  })

  it('reuses an already resolved registration mode when provided', async () => {
    await act(async () => {
      root.render(await PublicNav({ registrationMode: 'disabled' }))
    })

    expect(getRegistrationModeForRender).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Docs')
    expect(container.textContent).toContain('Blog')
    expect(container.textContent).toContain('Coming soon')
    expect(container.textContent).not.toContain('Login')
  })

  it('does not render auth controls when auth buttons are hidden', async () => {
    await act(async () => {
      root.render(<Nav variant='auth' hideAuthButtons />)
    })

    expect(container.textContent).not.toContain('Login')
    expect(container.textContent).not.toContain('Sign up')
    expect(container.textContent).not.toContain('Join Waitlist')
  })
})
