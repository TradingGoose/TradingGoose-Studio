import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  verify: vi.fn(),
  readSnapshot: vi.fn(),
  applyUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: mocks.verify,
}))
vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedReviewTargetSnapshot: mocks.readSnapshot,
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyYjsUpdateInSocketServer: mocks.applyUpdate,
  SocketServerBridgeError: class SocketServerBridgeError extends Error {
    status = 500
  },
}))

describe('dashboard layout Yjs snapshot route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.verify.mockResolvedValue({ hasAccess: true, workspaceId: 'workspace-1' })
    mocks.readSnapshot.mockResolvedValue({ snapshotBase64: '', runtime: { docState: 'active' } })
  })

  it('reserves snapshot bootstrap for writer sessions', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/yjs/sessions/layout-1/snapshot?targetKind=entity&sessionId=layout-1&workspaceId=workspace-1&entityKind=dashboard_layout&entityId=layout-1&accessMode=read'
      ),
      { params: Promise.resolve({ sessionId: 'layout-1' }) }
    )

    expect(response?.status).toBe(400)
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it('rejects dashboard layout writes on the generic snapshot route', async () => {
    const query =
      'targetKind=entity&sessionId=layout-1&workspaceId=workspace-1' +
      '&entityKind=dashboard_layout&entityId=layout-1&ownerUserId=user-1&accessMode=write'
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(`http://localhost/api/yjs/sessions/layout-1/snapshot?${query}`, {
        method: 'POST',
        body: JSON.stringify({ updateBase64: 'dXBkYXRl' }),
      }),
      { params: Promise.resolve({ sessionId: 'layout-1' }) }
    )

    expect(response?.status).toBe(400)
    expect(mocks.applyUpdate).not.toHaveBeenCalled()
  })

  it('forwards a saved-entity identity sidecar with the Yjs update', async () => {
    const query =
      'targetKind=entity&sessionId=skill-1&workspaceId=workspace-1' +
      '&entityKind=skill&entityId=skill-1&accessMode=write'
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(`http://localhost/api/yjs/sessions/skill-1/snapshot?${query}`, {
        method: 'POST',
        body: JSON.stringify({
          updateBase64: 'dXBkYXRl',
          identity: { name: 'Renamed Skill' },
        }),
      }),
      { params: Promise.resolve({ sessionId: 'skill-1' }) }
    )

    expect(response?.status).toBe(200)
    expect(mocks.applyUpdate).toHaveBeenCalledWith(
      'skill-1',
      expect.stringContaining('accessMode=write'),
      'dXBkYXRl',
      { name: 'Renamed Skill' }
    )
  })
})
