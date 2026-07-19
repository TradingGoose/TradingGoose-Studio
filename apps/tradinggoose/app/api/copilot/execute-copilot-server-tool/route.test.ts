/** @vitest-environment node */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isToolId: vi.fn(),
  route: vi.fn(),
  stage: vi.fn(),
  accept: vi.fn(),
}))

vi.mock('@/lib/copilot/auth', () => ({
  authenticateCopilotRequestSessionOnly: () => mocks.auth(),
  createBadRequestResponse: (message: string) =>
    Response.json({ error: message, code: 'BAD_REQUEST' }, { status: 400 }),
  createRequestTracker: () => ({ requestId: 'request-1' }),
  createUnauthorizedResponse: () =>
    Response.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 }),
}))

vi.mock('@/lib/copilot/registry', () => ({ isToolId: mocks.isToolId }))

vi.mock('@/lib/copilot/tools/server/router', () => ({
  routeExecution: mocks.route,
}))

vi.mock('@/lib/copilot/tools/server/review-acceptance', () => ({
  acceptServerManagedToolReview: mocks.accept,
  stageServerManagedToolReview: mocks.stage,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

const layoutContext = {
  contextEntityKind: 'dashboard_layout',
  contextEntityId: 'layout-1',
  workspaceId: 'workspace-1',
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('./route')
  return POST(
    new NextRequest('https://studio.example.test/api/copilot/execute-copilot-server-tool', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

describe('execute copilot server tool route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: 'user-1', isAuthenticated: true })
    mocks.isToolId.mockReturnValue(true)
    mocks.route.mockResolvedValue({ success: true })
    mocks.stage.mockImplementation(async (_tool, _payload, result) => result)
    mocks.accept.mockResolvedValue({ success: true })
  })

  it.each([
    [
      'execution context without workspace scope',
      { ...layoutContext, workspaceId: undefined },
      'dashboard_layout context requires contextEntityId and workspaceId',
    ],
    [
      'composed context ids at the execution boundary',
      { ...layoutContext, contextEntityId: 'dashboard_layout:user-1:layout-1' },
      'dashboard_layout contextEntityId must be the raw layout id',
    ],
  ])('rejects dashboard layout %s', async (_case, context, expectedError) => {
    const response = await post({
      toolName: 'edit_layout',
      payload: { entityId: 'layout-1' },
      context,
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(expectedError)
    expect(mocks.route).not.toHaveBeenCalled()
  })

  it('passes dashboard layout identity into staged execution', async () => {
    const response = await post({
      toolName: 'edit_layout',
      payload: { entityId: 'layout-1' },
      context: layoutContext,
    })

    expect(response.status).toBe(200)
    expect(mocks.route).toHaveBeenCalledWith(
      'edit_layout',
      { entityId: 'layout-1' },
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        contextEntityKind: 'dashboard_layout',
        contextEntityId: 'layout-1',
      })
    )
  })

  it('passes review acceptance to the canonical dispatcher', async () => {
    const response = await post({
      toolName: 'edit_layout',
      reviewAction: 'accept',
      reviewToken: 'review-token-1',
      context: layoutContext,
    })

    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith(
      'edit_layout',
      'review-token-1',
      expect.objectContaining({ userId: 'user-1' })
    )
  })

  it('returns structured authorization denials from the canonical dispatcher', async () => {
    const denial = { code: 'access_denied', error: 'Access denied', retryable: false }
    mocks.route.mockRejectedValueOnce(new StructuredServerToolError({ status: 403, body: denial }))
    const response = await post({
      toolName: 'list_watchlist',
      payload: {},
      context: { workspaceId: 'workspace-1' },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(denial)
  })
})
