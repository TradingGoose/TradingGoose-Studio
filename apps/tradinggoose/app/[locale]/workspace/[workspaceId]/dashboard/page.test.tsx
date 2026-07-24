/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceDashboardPage from './page'

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  access: vi.fn(),
  ensureLayout: vi.fn(),
  readActive: vi.fn(),
  activateLayout: vi.fn(),
  clientProps: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))

vi.mock('@/lib/permissions/utils', () => ({ getCachedWorkspaceAccess: m.access }))

vi.mock('@/lib/dashboard-layouts/operations', () => ({
  activateDashboardLayout: m.activateLayout,
  ensureDashboardLayoutProvisioned: m.ensureLayout,
  readActiveDashboardLayoutProjection: m.readActive,
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/dashboard-client', () => ({
  DashboardClient: (props: Record<string, unknown>) => {
    m.clientProps = props
    return <div data-dashboard-client='true' />
  },
}))

const scope = { workspaceId: 'workspace-1', ownerUserId: 'user-1' }
const activeLayout = {
  id: 'layout-active',
  name: 'Active',
  sortOrder: 0,
  isActive: true,
  topology: {
    id: 'panel-1',
    type: 'panel',
    identityId: 'widget-1',
    widgetKey: null,
  },
}

const renderPage = async (layoutId?: string) =>
  renderToStaticMarkup(
    await WorkspaceDashboardPage({
      params: Promise.resolve({ workspaceId: 'workspace-1' }),
      searchParams: layoutId ? Promise.resolve({ layoutId }) : undefined,
    })
  )

describe('WorkspaceDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.clientProps = null
    m.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    m.access.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    m.ensureLayout.mockResolvedValue(undefined)
    m.activateLayout.mockResolvedValue(undefined)
    m.readActive.mockResolvedValue({ activeLayout, layouts: [activeLayout] })
  })

  it('falls back to the active layout when a deep-link id is unknown', async () => {
    await renderPage('layout-missing')

    expect(m.ensureLayout).toHaveBeenCalledWith(scope)
    expect(m.ensureLayout.mock.invocationCallOrder[0]).toBeLessThan(
      m.readActive.mock.invocationCallOrder[0]
    )
    expect(m.readActive).toHaveBeenCalledWith(scope)
    expect(m.activateLayout).not.toHaveBeenCalled()
    expect(m.clientProps).toMatchObject({
      initialTopology: activeLayout.topology,
      layoutId: 'layout-active',
      ownerUserId: 'user-1',
    })
    expect(m.clientProps).not.toHaveProperty('initialWidgets')
    expect(m.clientProps).not.toHaveProperty('initialColorPairs')
  })

  it('activates an owned layout requested by deep link', async () => {
    const requestedLayout = { ...activeLayout, id: 'layout-requested', name: 'Requested' }
    m.readActive
      .mockResolvedValueOnce({
        activeLayout,
        layouts: [activeLayout, { ...requestedLayout, isActive: false }],
      })
      .mockResolvedValueOnce({
        activeLayout: requestedLayout,
        layouts: [{ ...activeLayout, isActive: false }, requestedLayout],
      })

    await renderPage(requestedLayout.id)

    expect(m.activateLayout).toHaveBeenCalledWith(scope, requestedLayout.id)
    expect(m.readActive).toHaveBeenCalledTimes(2)
    expect(m.clientProps).toMatchObject({
      initialTopology: requestedLayout.topology,
      layoutId: requestedLayout.id,
    })
  })

  it('keeps a reader personal layout available while workspace entities remain read-only', async () => {
    m.access.mockResolvedValueOnce({ exists: true, hasAccess: true, canWrite: false })

    await renderPage()

    expect(m.ensureLayout).toHaveBeenCalledWith(scope)
    expect(m.readActive).toHaveBeenCalledWith(scope)
    expect(m.clientProps).toMatchObject({
      layoutId: 'layout-active',
      ownerUserId: 'user-1',
    })
  })

  it('does not create or read a layout when workspace access is denied', async () => {
    m.access.mockResolvedValueOnce({ exists: true, hasAccess: false, canWrite: false })

    const markup = await renderPage()

    expect(m.ensureLayout).not.toHaveBeenCalled()
    expect(m.readActive).not.toHaveBeenCalled()
    expect(markup).toBe('<div></div>')
    expect(m.clientProps).toBeNull()
  })
})
