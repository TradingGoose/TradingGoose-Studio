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
  clientProps: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))

vi.mock('@/lib/permissions/utils', () => ({ getCachedWorkspaceAccess: m.access }))

vi.mock('@/lib/dashboard-layouts/operations', () => ({
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
    m.ensureLayout.mockResolvedValue(undefined)
    m.readActive.mockResolvedValue({ activeLayout, layouts: [activeLayout] })
  })

  it('renders the active layout for the current user scope', async () => {
    await renderPage()

    expect(m.ensureLayout).toHaveBeenCalledWith(scope)
    expect(m.ensureLayout.mock.invocationCallOrder[0]).toBeLessThan(
      m.readActive.mock.invocationCallOrder[0]
    )
    expect(m.readActive).toHaveBeenCalledWith(scope)
    expect(m.clientProps).toMatchObject({
      layoutId: 'layout-active',
      ownerUserId: 'user-1',
      workspaceCanWrite: true,
    })
  })

  it('passes workspace write permission only for workspace entities', async () => {
    m.access.mockResolvedValueOnce({ exists: true, hasAccess: true, canWrite: false })

    await renderPage()

    expect(m.clientProps).toMatchObject({
      workspaceCanWrite: false,
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
