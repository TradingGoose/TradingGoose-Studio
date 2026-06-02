import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let capturedNamespaces: readonly string[] | undefined

vi.mock('@/app/intl-provider', () => ({
  default: ({
    children,
    namespaces,
  }: {
    children: React.ReactNode
    namespaces?: readonly string[]
  }) => {
    capturedNamespaces = namespaces
    return <div data-testid='intl-provider'>{children}</div>
  },
}))

vi.mock('@/app/(landing)/components/background/background', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='landing-background'>{children}</div>
  ),
}))

describe('Landing layout i18n namespaces', () => {
  beforeEach(() => {
    capturedNamespaces = undefined
  })

  it('keeps the shared landing layout scoped to public namespaces', async () => {
    const LandingLayout = (await import('./layout')).default
    const result = LandingLayout({ children: <div>landing content</div> })

    expect(renderToStaticMarkup(result)).toContain('landing content')
    expect(capturedNamespaces).toEqual(
      expect.arrayContaining(['nav', 'registration', 'landing', 'blog', 'careers'])
    )
    expect(capturedNamespaces).not.toContain('workspace')
  })
})
