/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), scope: vi.fn(), read: vi.fn(), submit: vi.fn() }))
vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mocks.auth,
  AuthType: { INTERNAL_JWT: 'internal_jwt' },
}))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: mocks.scope }))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))
vi.mock('@/lib/workflows/human-in-the-loop/service', () => ({
  readWorkflowCheckpoint: mocks.read,
  submitWorkflowCheckpoint: mocks.submit,
  WorkflowCheckpointError: class extends Error {
    constructor(
      message: string,
      readonly statusCode = 409
    ) {
      super(message)
    }
  },
}))

import { GET, POST } from './route'

const context = { params: Promise.resolve({ workflowId: 'workflow', executionId: 'execution' }) }
const request = (body?: unknown, contentType = 'application/json') =>
  new NextRequest('http://localhost/api/resume/workflow/execution', {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': contentType } }),
  })

describe('workflow review authorization and input boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ success: true, userId: 'reviewer', authType: 'session' })
    mocks.scope.mockResolvedValue({
      ok: true,
      userId: 'reviewer',
      workspaceId: 'workspace',
      workflowId: 'workflow',
    })
    mocks.read.mockResolvedValue({
      executionId: 'execution',
      revision: 1,
      pausePoints: [],
      status: 'paused',
    })
    mocks.submit.mockResolvedValue({ executionId: 'execution', revision: 1, status: 'queued' })
  })

  it('rejects internal automation tokens before accessing review data', async () => {
    mocks.auth.mockResolvedValue({ success: true, userId: 'owner', authType: 'internal_jwt' })
    expect((await GET(request(), context)).status).toBe(403)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.scope).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404])(
    'does not expose checkpoints when scope authorization returns %i',
    async (status) => {
      mocks.scope.mockResolvedValue({ ok: false, error: 'Denied', status })
      expect((await GET(request(), context)).status).toBe(status)
      expect(mocks.read).not.toHaveBeenCalled()
      expect(
        (await POST(request({ revision: 1, pausePointId: 'point', input: {} }), context)).status
      ).toBe(status)
      expect(mocks.submit).not.toHaveBeenCalled()
    }
  )

  it('binds reads to the authorized workspace and exposes read-only permission', async () => {
    mocks.scope
      .mockResolvedValueOnce({ ok: true, workspaceId: 'workspace', userId: 'reviewer' })
      .mockResolvedValueOnce({ ok: false, error: 'Read-only', status: 403 })
    const response = await GET(request(), context)
    expect(mocks.read).toHaveBeenCalledWith('execution', 'workflow', 'workspace')
    expect((await response.json()).canSubmit).toBe(false)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('uses authenticated identity rather than caller-supplied reviewer or workspace', async () => {
    const response = await POST(
      request({
        revision: 2,
        pausePointId: 'virtual:point',
        input: { approved: true },
        reviewerId: 'forged',
        workspaceId: 'other',
      }),
      context
    )
    expect(response.status).toBe(200)
    expect(mocks.scope).toHaveBeenCalledWith(expect.anything(), 'workflow', 'write')
    expect(mocks.submit).toHaveBeenCalledWith({
      executionId: 'execution',
      workflowId: 'workflow',
      workspaceId: 'workspace',
      reviewerId: 'reviewer',
      revision: 2,
      pausePointId: 'virtual:point',
      input: { approved: true },
    })
  })

  it.each([
    {},
    { revision: 0, pausePointId: 'point' },
    { revision: 1.5, pausePointId: 'point' },
    [],
  ])('rejects malformed submissions: %j', async (body) => {
    expect((await POST(request(body), context)).status).toBe(400)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('rejects cross-site simple content types and oversized bodies', async () => {
    expect((await POST(request({}, 'text/plain'), context)).status).toBe(415)
    expect((await POST(request({ text: 'x'.repeat(256_001) }), context)).status).toBe(413)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})
