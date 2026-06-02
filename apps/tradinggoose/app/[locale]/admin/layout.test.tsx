import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  })

  it('renders admin content inside the admin navbar', async () => {
    mockGetSystemAdminAccess.mockResolvedValue({
      isSystemAdmin: false,
      canBootstrapSystemAdmin: true,
    })

    const AdminLayout = (await import('./layout')).default
    const result = await AdminLayout({ children: <div>admin content</div> })

    expect(renderToStaticMarkup(result)).toContain('admin content')
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
