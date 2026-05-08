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

vi.mock('@/app/api/auth/oauth/utils', () => ({
  refreshTokenIfNeeded: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
}))

vi.mock('@/tools/utils', () => ({
  getTool: (...args: unknown[]) => mockGetTool(...args),
  getToolAsync: (...args: unknown[]) => mockGetToolAsync(...args),
}))

describe('copilot execute-tool route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    mockGetEffectiveDecryptedEnv.mockResolvedValue({})
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: true, workspaceId: null })
  })

  it('rejects order placement without workspace scope before loading env or executing', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/copilot/execute-tool', {
        body: JSON.stringify({
          arguments: {},
          toolCallId: 'tool-call-1',
          toolName: 'trading_place_order',
        }),
        method: 'POST',
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'trading_place_order requires workspaceId',
      success: false,
      toolCallId: 'tool-call-1',
    })
    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
    expect(mockGetTool).not.toHaveBeenCalled()
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('executes copilot order placement with workspace scope and no workflow requirement', async () => {
    mockGetTool.mockReturnValue({ id: 'trading_place_order', params: {} })
    mockExecuteTool.mockResolvedValue({ success: true, output: { order: { id: 'order-1' } } })
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/copilot/execute-tool', {
        body: JSON.stringify({
          arguments: { provider: 'alpaca' },
          toolCallId: 'tool-call-1',
          toolName: 'trading_place_order',
          workspaceId: 'workspace-1',
        }),
        method: 'POST',
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
        provider: 'alpaca',
      })
    )
  })
})
