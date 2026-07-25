/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyDashboardStructureMutationInSocketServer: mocks.apply,
}))
vi.mock('@/app/api/saved-entity-error-response', () => ({
  createSavedEntityErrorResponse: vi.fn(() => null),
}))

const invoke = (body: BodyInit) =>
  POST(
    new NextRequest(
      'http://localhost/api/workspaces/workspace-1/dashboard-layouts/layout-1/structure',
      { method: 'POST', body }
    ),
    { params: Promise.resolve({ id: 'workspace-1', layoutId: 'layout-1' }) }
  )

describe('dashboard structure route', () => {
  beforeEach(() => mocks.apply.mockReset().mockResolvedValue(undefined))

  it('rejects malformed JSON before crossing the realtime boundary', async () => {
    const response = await invoke('{')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON in request body' })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null, 204],
    [
      JSON.stringify({ type: 'resize', groupId: 'group-1', sizes: [40, 60] }),
      { type: 'resize', groupId: 'group-1', sizes: [40, 60] },
      204,
    ],
  ])('forwards valid JSON unchanged', async (body, mutation, status) => {
    const response = await invoke(body)

    expect(response.status).toBe(status)
    expect(mocks.apply).toHaveBeenLastCalledWith({
      entityId: 'layout-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      mutation,
    })
  })
})
