import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SocketServerBridgeError } from '@/lib/yjs/server/snapshot-bridge'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  verify: vi.fn(),
  applyUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: mocks.verify,
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', async (importOriginal) => ({
  ...(await importOriginal()),
  applyYjsUpdateInSocketServer: mocks.applyUpdate,
}))

async function postSkill(body: Record<string, unknown>) {
  const query =
    'targetKind=entity&sessionId=skill-1&workspaceId=workspace-1' +
    '&entityKind=skill&entityId=skill-1&accessMode=write'
  const { POST } = await import('./route')
  return POST(
    new NextRequest(`http://localhost/api/yjs/sessions/skill-1/snapshot?${query}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId: 'skill-1' }) }
  )
}

describe('dashboard layout Yjs snapshot route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.verify.mockResolvedValue({ hasAccess: true, workspaceId: 'workspace-1' })
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
    const response = await postSkill({
      updateBase64: 'dXBkYXRl',
      identity: { name: 'Renamed Skill' },
    })

    expect(response?.status).toBe(200)
    expect(mocks.applyUpdate).toHaveBeenCalledWith(
      'skill-1',
      expect.stringContaining('accessMode=write'),
      'dXBkYXRl',
      { name: 'Renamed Skill' }
    )
  })

  it('returns the canonical retryable response when realtime persistence is unavailable', async () => {
    mocks.applyUpdate.mockRejectedValueOnce(new SocketServerBridgeError(502, 'Unavailable'))
    const response = await postSkill({ updateBase64: 'dXBkYXRl' })
    const payload = await response?.json()

    expect(response?.status).toBe(503)
    expect(payload).toMatchObject({
      code: 'SAVED_ENTITY_REALTIME_REQUIRED',
      retryable: true,
    })
  })
})
