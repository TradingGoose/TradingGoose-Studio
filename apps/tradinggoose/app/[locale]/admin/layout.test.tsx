import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANONICAL_CALLBACK_PATH_HEADER } from '@/i18n/utils'

let capturedGlobalNavbarProps:
  | {
      isSystemAdmin?: boolean
      navigationMode?: 'workspace' | 'admin'
    }
  | undefined

const mockNotFound = vi.fn(() => {
  throw new Error('notFound')
})
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})
const mockGetSystemAdminAccess = vi.fn()
const mockHeaders = vi.fn()

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}))

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}))

vi.mock('@/i18n/navigation', () => ({
  redirect: ({
    href,
    locale,
  }: {
    href: string | { pathname: string; query?: Record<string, string> }
    locale?: string
  }) => {
    const canonicalPath =
      typeof href === 'string'
        ? href
        : `${href.pathname}${href.query ? `?${new URLSearchParams(href.query).toString()}` : ''}`
    const localizedPath =
      locale && canonicalPath.startsWith('/') ? `/${locale}${canonicalPath}` : canonicalPath

    return mockRedirect(localizedPath)
  },
}))

vi.mock('@/lib/admin/access', () => ({
  getSystemAdminAccess: (...args: unknown[]) => mockGetSystemAdminAccess(...args),
}))

vi.mock('@/global-navbar', () => ({
  GlobalNavbar: ({
    children,
    isSystemAdmin,
    navigationMode,
  }: {
    children: React.ReactNode
    isSystemAdmin?: boolean
    navigationMode?: 'workspace' | 'admin'
  }) => {
    capturedGlobalNavbarProps = { isSystemAdmin, navigationMode }
    return <div data-testid='global-navbar'>{children}</div>
  },
}))

describe('Admin layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    capturedGlobalNavbarProps = undefined
    mockHeaders.mockResolvedValue(new Headers())

    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`redirect:${url}`)
    })
  })

  it('renders admin content inside the admin navbar', async () => {
    mockGetSystemAdminAccess.mockResolvedValue({
      isAuthenticated: true,
      isSystemAdmin: false,
      canBootstrapSystemAdmin: true,
    })

    const AdminLayout = (await import('./layout')).default
    const result = await AdminLayout({
      children: <div>admin content</div>,
      params: Promise.resolve({ locale: 'zh' }),
    })

    expect(renderToStaticMarkup(result)).toContain('admin content')
    expect(capturedGlobalNavbarProps).toEqual({
      isSystemAdmin: false,
      navigationMode: 'admin',
    })
    expect(mockGetSystemAdminAccess).toHaveBeenCalledWith(expect.any(Headers))
  })

  it('redirects signed-out admin entry to login with the current callback target', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([[CANONICAL_CALLBACK_PATH_HEADER, '/admin/billing?from=nav']])
    )
    mockGetSystemAdminAccess.mockResolvedValue({
      isAuthenticated: false,
      isSystemAdmin: false,
      canBootstrapSystemAdmin: false,
    })

    const AdminLayout = (await import('./layout')).default

    await expect(
      AdminLayout({
        children: <div>admin content</div>,
        params: Promise.resolve({ locale: 'es' }),
      })
    ).rejects.toThrow('redirect:/es/login?reauth=1&callbackUrl=%2Fadmin%2Fbilling%3Ffrom%3Dnav')

    expect(mockRedirect).toHaveBeenCalledWith(
      '/es/login?reauth=1&callbackUrl=%2Fadmin%2Fbilling%3Ffrom%3Dnav'
    )
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it('calls notFound when the user cannot access admin routes', async () => {
    mockGetSystemAdminAccess.mockResolvedValue({
      isAuthenticated: true,
      isSystemAdmin: false,
      canBootstrapSystemAdmin: false,
    })

    const AdminLayout = (await import('./layout')).default

    await expect(
      AdminLayout({
        children: <div>admin content</div>,
        params: Promise.resolve({ locale: 'zh' }),
      })
    ).rejects.toThrow('notFound')
    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })
})
