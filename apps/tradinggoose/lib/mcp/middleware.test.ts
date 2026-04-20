import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockGetUserEntityPermissions } = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

import { withMcpAuth } from '@/lib/mcp/middleware'

describe('MCP middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows session-authenticated requests with sufficient workspace access', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockGetUserEntityPermissions.mockResolvedValue('write')

    const handler = vi.fn(async (_request: NextRequest, context) =>
      NextResponse.json({ context })
    )

    const wrapped = withMcpAuth('write')(handler)
    const response = await wrapped(
      new NextRequest('http://localhost/api/mcp/tools/execute?workspaceId=workspace-1')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(body.context).toMatchObject({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(mockCheckSessionOrInternalAuth).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { requireWorkflowId: false }
    )
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(
      'user-1',
      'workspace',
      'workspace-1'
    )
  })

  it('allows internal-authenticated requests', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'system-user',
      authType: 'internal_jwt',
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    const handler = vi.fn(async (_request: NextRequest, context) =>
      NextResponse.json({ context })
    )

    const wrapped = withMcpAuth('admin')(handler)
    const response = await wrapped(
      new NextRequest('http://localhost/api/mcp/tools/execute?workspaceId=workspace-1')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(body.context).toMatchObject({
      userId: 'system-user',
      workspaceId: 'workspace-1',
    })
  })

  it('rejects API key access at the middleware boundary', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'API key access not allowed for this endpoint',
    })

    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const wrapped = withMcpAuth('read')(handler)
    const response = await wrapped(
      new NextRequest('http://localhost/api/mcp/tools/execute?workspaceId=workspace-1', {
        headers: {
          'x-api-key': 'secret-key',
        },
      })
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({
      success: false,
      error: 'API key access not allowed for this endpoint',
    })
    expect(handler).not.toHaveBeenCalled()
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('rejects requests that do not meet the required permission level', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockGetUserEntityPermissions.mockResolvedValue('read')

    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const wrapped = withMcpAuth('write')(handler)
    const response = await wrapped(
      new NextRequest('http://localhost/api/mcp/tools/execute?workspaceId=workspace-1')
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({
      success: false,
      error: 'Write or admin permission required for MCP server management',
    })
    expect(handler).not.toHaveBeenCalled()
  })
})
