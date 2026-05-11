/**
 * @vitest-environment node
 */

import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckWorkspaceAccess,
  mockExecuteTool,
  mockGetEffectiveDecryptedEnv,
  mockGetSession,
  mockGetTool,
  mockGetToolAsync,
  mockVerifyWorkflowAccess,
} = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockGetEffectiveDecryptedEnv: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetTool: vi.fn(),
  mockGetToolAsync: vi.fn(),
  mockVerifyWorkflowAccess: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {},
}))

vi.mock('@tradinggoose/db/schema', () => ({
  account: {
    id: 'account.id',
    providerId: 'account.providerId',
    updatedAt: 'account.updatedAt',
    userId: 'account.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/copilot/auth', () => ({
  createBadRequestResponse: (message: string) =>
    NextResponse.json({ error: message }, { status: 400 }),
  createInternalServerErrorResponse: (message: string) =>
    NextResponse.json({ error: message }, { status: 500 }),
  createRequestTracker: () => ({ requestId: 'request-1' }),
  createUnauthorizedResponse: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  createPermissionError: vi.fn(() => 'Forbidden'),
  verifyWorkflowAccess: (...args: unknown[]) => mockVerifyWorkflowAccess(...args),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: (...args: unknown[]) => mockGetEffectiveDecryptedEnv(...args),
}))

vi.mock('@/lib/execution/constants', () => ({
  DEFAULT_EXECUTION_TIMEOUT_MS: 30_000,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mockCheckWorkspaceAccess(...args),
}))

vi.mock('@/lib/trello/auth', () => ({
  getTrelloApiKey: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/oauth/tokens', () => ({
  refreshTokenIfNeeded: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
}))

vi.mock('@/tools/utils', () => ({
  getTool: (...args: unknown[]) => mockGetTool(...args),
  getToolAsync: (...args: unknown[]) => mockGetToolAsync(...args),
}))

const postExecuteTool = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/copilot/execute-tool', {
    body: JSON.stringify(body),
    method: 'POST',
  })

describe('copilot execute-tool route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    mockGetEffectiveDecryptedEnv.mockResolvedValue({})
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: true, workspaceId: null })
  })

  it.each([
    ['trading_place_order', 'write'],
    ['trading_order_history', 'read'],
    ['trading_order_detail', 'read'],
  ] as const)(
    'rejects %s without workspace scope before loading env or executing',
    async (toolName, access) => {
      mockGetTool.mockReturnValue({
        id: toolName,
        execution: { workspace: { required: true, access } },
        params: {},
      })
      const { POST } = await import('./route')

      const response = await POST(
        postExecuteTool({
          arguments: {},
          toolCallId: 'tool-call-1',
          toolName,
        })
      )

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: `${toolName} requires workspaceId`,
        success: false,
        toolCallId: 'tool-call-1',
      })
      expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
      expect(mockGetTool).toHaveBeenCalledWith(toolName)
      expect(mockExecuteTool).not.toHaveBeenCalled()
    }
  )

  it('executes copilot order placement with workspace scope and no workflow requirement', async () => {
    mockGetTool.mockReturnValue({
      id: 'trading_place_order',
      execution: {
        workspace: { required: true, access: 'write' },
        submissionSource: 'required',
      },
      params: {},
    })
    mockExecuteTool.mockResolvedValue({ success: true, output: { order: { id: 'order-1' } } })
    const { POST } = await import('./route')

    const response = await POST(
      postExecuteTool({
        arguments: {},
        toolCallId: 'tool-call-1',
        toolName: 'trading_place_order',
        workspaceId: 'workspace-1',
      })
    )

    expect(response.status).toBe(200)
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mockVerifyWorkflowAccess).not.toHaveBeenCalled()
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'trading_place_order',
      expect.objectContaining({
        _context: expect.objectContaining({
          submissionSource: 'copilot',
          userId: 'user-1',
          workspaceId: 'workspace-1',
        }),
      })
    )
  })

  it('rejects write-scoped tools without write access before loading env or executing', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: false,
    })
    mockGetTool.mockReturnValue({
      id: 'trading_place_order',
      execution: {
        workspace: { required: true, access: 'write' },
        submissionSource: 'required',
      },
      params: {},
    })
    const { POST } = await import('./route')

    const response = await POST(
      postExecuteTool({
        arguments: { query: 'secret-backed request' },
        toolCallId: 'tool-call-2',
        toolName: 'trading_place_order',
        workspaceId: 'workspace-1',
      })
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Workspace not found',
      success: false,
      toolCallId: 'tool-call-2',
    })
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
    expect(mockGetTool).toHaveBeenCalledWith('trading_place_order')
    expect(mockGetToolAsync).not.toHaveBeenCalled()
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('allows read-only workspace-scoped tools for read-only workspace collaborators', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: false,
    })
    mockGetTool.mockReturnValue({
      id: 'trading_order_history',
      execution: { workspace: { required: true, access: 'read' } },
      params: {},
    })
    mockExecuteTool.mockResolvedValue({ success: true, output: { history: [] } })
    const { POST } = await import('./route')

    const response = await POST(
      postExecuteTool({
        arguments: {},
        toolCallId: 'tool-call-2',
        toolName: 'trading_order_history',
        workspaceId: 'workspace-1',
      })
    )

    expect(response.status).toBe(200)
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'trading_order_history',
      expect.objectContaining({
        _context: expect.objectContaining({
          workspaceId: 'workspace-1',
          userId: 'user-1',
        }),
      })
    )
  })

  it('requires workflow write access before resolving tools or workspace env', async () => {
    mockVerifyWorkflowAccess.mockResolvedValue({
      hasAccess: false,
      workspaceId: 'workspace-1',
    })
    const { POST } = await import('./route')

    const response = await POST(
      postExecuteTool({
        arguments: { query: 'workflow-scoped request' },
        toolCallId: 'tool-call-3',
        toolName: 'http_request',
        workflowId: 'workflow-1',
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(mockVerifyWorkflowAccess).toHaveBeenCalledWith('user-1', 'workflow-1', {
      requireWrite: true,
    })
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
    expect(mockGetTool).not.toHaveBeenCalled()
    expect(mockGetToolAsync).not.toHaveBeenCalled()
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })
})
