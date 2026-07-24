import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const proxyMocks = vi.hoisted(() => ({
  checkHybridAuth: vi.fn(),
  executeTool: vi.fn(),
  getTool: vi.fn(),
  validateRequiredParametersAfterMerge: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({ checkHybridAuth: proxyMocks.checkHybridAuth }))
vi.mock('@/lib/credentials/oauth-route', () => ({ resolveOAuthRouteCredential: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: proxyMocks.executeTool }))
vi.mock('@/tools/utils', () => ({
  getTool: proxyMocks.getTool,
  validateRequiredParametersAfterMerge: proxyMocks.validateRequiredParametersAfterMerge,
}))
vi.mock('@/lib/environment', () => ({ isDev: false }))
vi.mock('@/lib/utils', () => ({ generateRequestId: () => 'request-1' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

const request = (body: unknown) =>
  new NextRequest('http://localhost/api/proxy', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

describe('POST /api/proxy tool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    proxyMocks.checkHybridAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    proxyMocks.getTool.mockReturnValue({ id: 'watchlist_read_lists', outputs: {} })
    proxyMocks.executeTool.mockResolvedValue({ success: true, output: { watchlists: [] } })
  })

  it('rebuilds caller-controlled execution context from the authenticated principal', async () => {
    const response = await POST(
      request({
        toolId: 'watchlist_read_lists',
        params: {
          _context: {
            userId: 'attacker',
            workspaceId: 'workspace-2',
            toolExecutionId: 'attacker-execution',
          },
        },
        executionContext: {
          userId: 'attacker',
          workspaceId: 'workspace-2',
          toolExecutionId: 'attacker-execution',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(proxyMocks.executeTool).toHaveBeenCalledWith(
      'watchlist_read_lists',
      {
        _context: {
          userId: 'user-1',
          workspaceId: 'workspace-2',
          toolExecutionId: 'request-1',
          submissionSource: 'manual',
          isDeployedContext: true,
        },
      },
      true,
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-2' })
    )
  })

  it('cannot move a workspace API key into another workspace', async () => {
    proxyMocks.checkHybridAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      apiKeyType: 'workspace',
    })

    const response = await POST(
      request({
        toolId: 'watchlist_read_lists',
        params: { _context: { workspaceId: 'workspace-2' } },
      })
    )

    expect(response.status).toBe(403)
    expect(proxyMocks.executeTool).not.toHaveBeenCalled()
  })
})
