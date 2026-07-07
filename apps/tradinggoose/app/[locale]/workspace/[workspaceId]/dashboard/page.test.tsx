/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceDashboardPage from './page'

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  access: vi.fn(),
  ensureActive: vi.fn(),
  clientProps: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))

vi.mock('@/lib/permissions/utils', () => ({ getCachedWorkspaceAccess: m.access }))

vi.mock('@/lib/dashboard-layouts/operations', () => ({
  ensureActiveDashboardLayoutProjection: m.ensureActive,
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
  layout: {
    id: 'panel-1',
    type: 'panel',
    widget: null,
  },
  colorPairs: { pairs: [] },
}

const renderPage = async () =>
  renderToStaticMarkup(
    await WorkspaceDashboardPage({
      params: Promise.resolve({ workspaceId: 'workspace-1' }),
    })
  )

describe('WorkspaceDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.clientProps = null
    m.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    m.access.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    m.ensureActive.mockResolvedValue({ activeLayout, layouts: [activeLayout] })
  })

  it('renders the ensured active layout for the current user scope', async () => {
    await renderPage()

    expect(m.ensureActive).toHaveBeenCalledWith(scope)
    expect(m.clientProps).toMatchObject({
      layoutId: 'layout-active',
      ownerUserId: 'user-1',
      canWrite: true,
    })
  })

  it('does not create or read a layout when workspace access is denied', async () => {
    m.access.mockResolvedValueOnce({ exists: true, hasAccess: false, canWrite: false })

    const markup = await renderPage()

    expect(m.ensureActive).not.toHaveBeenCalled()
    expect(markup).toBe('<div></div>')
    expect(m.clientProps).toBeNull()
  })
})
