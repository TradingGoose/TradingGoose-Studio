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

describe('Invite layout i18n namespaces', () => {
  beforeEach(() => {
    capturedNamespaces = undefined
  })

  it('includes auth messages for invite route fallback actions', async () => {
    const InviteLayout = (await import('./layout')).default
    const result = InviteLayout({ children: <div>invite content</div> })

    expect(renderToStaticMarkup(result)).toContain('invite content')
    expect(capturedNamespaces).toEqual(expect.arrayContaining(['nav', 'invite', 'auth']))
  })
})
