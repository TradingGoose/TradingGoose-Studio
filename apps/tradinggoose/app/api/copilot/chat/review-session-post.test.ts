/**
 * @vitest-environment node
 */
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockAuth,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

describe('Copilot Chat POST Shared Review Sessions', () => {
  const mockSelect = vi.fn()
  const mockTransaction = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()
  const mockProxyCopilotRequest = vi.fn()
  const mockBuildAppendReviewTurn = vi.fn(() => ({
    turn: {
      id: 'turn-1',
      sessionId: 'review-session-1',
      sequence: 0,
      status: 'completed',
      userMessageItemId: 'user-message-1',
    },
    items: [
      {
        sessionId: 'review-session-1',
        turnId: 'turn-1',
        sequence: 0,
        itemId: 'user-message-1',
        kind: 'message',
        messageRole: 'user',
        content: 'Please update the summary',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        sessionId: 'review-session-1',
        turnId: 'turn-1',
        sequence: 1,
        itemId: 'assistant-message-1',
        kind: 'message',
        messageRole: 'assistant',
        content: 'Saved response',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ],
  }))

  const selectOrderBy = vi.fn()
  const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))

  const txInsertValues = vi.fn().mockResolvedValue(undefined)
  const txInsert = vi.fn(() => ({ values: txInsertValues }))
  const txUpdateWhere = vi.fn().mockResolvedValue(undefined)
  const txUpdateSet = vi.fn(() => ({ where: txUpdateWhere }))
  const txUpdate = vi.fn(() => ({ set: txUpdateSet }))

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()

    mockAuth({
      id: 'collaborator-user',
      email: 'collaborator@example.com',
      name: 'Collaborator',
    }).setAuthenticated()

    selectOrderBy.mockResolvedValue([])
    mockSelect.mockReturnValue({ from: selectFrom })

    mockTransaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        insert: txInsert,
        update: txUpdate,
      })
    )

    mockProxyCopilotRequest.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: 'Saved response',
      }),
    })

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: mockSelect,
        transaction: mockTransaction,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      copilotReviewItems: {
        sessionId: 'copilot_review_items.session_id',
        sequence: 'copilot_review_items.sequence',
        kind: 'copilot_review_items.kind',
      },
      copilotReviewTurns: {
        sessionId: 'copilot_review_turns.session_id',
      },
      copilotReviewSessions: {
        id: 'copilot_review_sessions.id',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
      asc: vi.fn((field: unknown) => ({ field, type: 'asc' })),
      desc: vi.fn((field: unknown) => ({ field, type: 'desc' })),
      eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
      inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values, type: 'inArray' })),
      sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    }))

    vi.doMock('@/lib/copilot/auth', () => ({
      authenticateCopilotRequestSessionOnly: vi.fn(),
      createBadRequestResponse: vi.fn((message: string) =>
        NextResponse.json({ error: message }, { status: 400 })
      ),
      createInternalServerErrorResponse: vi.fn((message: string) =>
        NextResponse.json({ error: message }, { status: 500 })
      ),
      createRequestTracker: vi.fn(() => ({
        requestId: 'request-1',
        getDuration: () => 0,
      })),
      createUnauthorizedResponse: vi.fn(() =>
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      ),
    }))

    vi.doMock('@/lib/copilot/config', () => ({
      getCopilotModel: vi.fn(() => ({
        model: 'claude-4.5-sonnet',
      })),
    }))

    vi.doMock('@/lib/copilot/agent/utils', () => ({
      requestCopilotTitle: vi.fn(),
    }))

    vi.doMock('@/lib/copilot/review-sessions/thread-history', () => ({
      buildAppendReviewTurn: mockBuildAppendReviewTurn,
      mapReviewItemToApi: vi.fn((row: any) => row),
      MESSAGE_ROLES: {
        USER: 'user',
        ASSISTANT: 'assistant',
        SYSTEM: 'system',
      },
      REVIEW_ITEM_KINDS: {
        MESSAGE: 'message',
      },
    }))

    vi.doMock('@/lib/copilot/review-sessions/permissions', () => ({
      loadReviewSessionForUser: mockLoadReviewSessionForUser,
    }))

    vi.doMock('@/lib/copilot/review-sessions/types', () => ({
      REVIEW_ENTITY_KINDS: ['workflow', 'skill', 'custom_tool', 'mcp_server', 'indicator'],
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        COPILOT_MODEL: undefined,
        COPILOT_PROVIDER: undefined,
        COPILOT_API_KEY: 'test-copilot-key',
      },
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      getUserEntityPermissions: vi.fn(),
      hasWorkspaceAdminAccess: vi.fn(),
    }))

    vi.doMock('@/lib/uploads', () => ({
      CopilotFiles: {
        processCopilotAttachments: vi.fn().mockResolvedValue([]),
      },
    }))

    vi.doMock('@/lib/uploads/utils/file-utils', () => ({
      createFileContent: vi.fn(),
    }))

    vi.doMock('@/lib/utils', () => ({
      encodeSSE: vi.fn(),
      SSE_HEADERS: {},
    }))

    vi.doMock('@/app/api/copilot/proxy', () => ({
      proxyCopilotRequest: mockProxyCopilotRequest,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('persists a collaborator reply on an existing shared saved-entity session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
      title: 'Shared skill review',
      conversationId: null,
    })

    const request = createMockRequest('POST', {
      message: 'Please update the summary',
      reviewSessionId: 'review-session-1',
      stream: false,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewSessionId: 'review-session-1',
    })

    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'review-session-1',
      'collaborator-user'
    )
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith({
      endpoint: '/api/copilot',
      body: expect.objectContaining({
        message: 'Please update the summary',
        userId: 'collaborator-user',
        model: 'claude-4.5-sonnet',
        chatId: 'review-session-1',
      }),
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(txInsertValues).toHaveBeenCalledTimes(2)
    expect(mockBuildAppendReviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewSessionId: 'review-session-1',
        existingMessages: [],
      })
    )
  })
})
