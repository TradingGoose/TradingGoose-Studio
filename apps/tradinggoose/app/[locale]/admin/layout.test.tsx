import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let capturedNamespaces: readonly string[] | undefined
let capturedGlobalNavbarProps:
  | {
      isSystemAdmin?: boolean
      navigationMode?: 'workspace' | 'admin'
    }
  | undefined

const mockNotFound = vi.fn(() => {
  throw new Error('notFound')
})
const mockGetSystemAdminAccess = vi.fn()

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}))

vi.mock('@/lib/admin/access', () => ({
  getSystemAdminAccess: (...args: unknown[]) => mockGetSystemAdminAccess(...args),
}))

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

describe('Admin layout i18n namespaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    capturedNamespaces = undefined
    capturedGlobalNavbarProps = undefined
  })

  it('provides nav, workspace, and admin messages to the admin navbar tree', async () => {
    mockGetSystemAdminAccess.mockResolvedValue({
      isSystemAdmin: false,
      canBootstrapSystemAdmin: true,
    })

    const AdminLayout = (await import('./layout')).default
    const result = await AdminLayout({ children: <div>admin content</div> })

    expect(renderToStaticMarkup(result)).toContain('admin content')
    expect(capturedNamespaces).toEqual(expect.arrayContaining(['nav', 'workspace', 'admin']))
    expect(capturedGlobalNavbarProps).toEqual({
      isSystemAdmin: false,
      navigationMode: 'admin',
    })
  })

  it('calls notFound when the user cannot access admin routes', async () => {
    mockGetSystemAdminAccess.mockResolvedValue({
      isSystemAdmin: false,
      canBootstrapSystemAdmin: false,
    })

    const AdminLayout = (await import('./layout')).default

    await expect(AdminLayout({ children: <div>admin content</div> })).rejects.toThrow('notFound')
    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })
})
