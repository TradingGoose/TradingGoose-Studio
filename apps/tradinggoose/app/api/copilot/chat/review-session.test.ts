/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Copilot Chat Review Session GET', () => {
  const mockSelect = vi.fn()
  const mockFromSessions = vi.fn()
  const mockWhereSessions = vi.fn()
  const mockOrderBySessions = vi.fn()
  const mockFromItems = vi.fn()
  const mockWhereItems = vi.fn()
  const mockOrderByItems = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()

  const mockMapReviewItemToApi = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()

    mockSelect.mockImplementation((selection?: unknown) =>
      selection ? { from: mockFromSessions } : { from: mockFromItems }
    )
    mockFromSessions.mockReturnValue({ where: mockWhereSessions })
    mockWhereSessions.mockReturnValue({ orderBy: mockOrderBySessions })
    mockFromItems.mockReturnValue({ where: mockWhereItems })
    mockWhereItems.mockReturnValue({ orderBy: mockOrderByItems })
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      draftSessionId: null,
      title: 'Shared skill review',
      model: 'claude-4.5-sonnet',
      conversationId: 'conversation-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    mockOrderByItems.mockResolvedValue([
      {
        itemId: 'message-1',
        sessionId: 'review-session-1',
        messageRole: 'user',
        content: 'Please review this skill',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        itemId: 'message-2',
        sessionId: 'review-session-1',
        messageRole: 'assistant',
        content: 'Looks good',
        timestamp: '2026-01-01T00:01:00.000Z',
      },
      {
        itemId: 'workflow-message-1',
        sessionId: 'review-session-2',
        messageRole: 'user',
        content: 'Please review this workflow',
        timestamp: '2026-01-03T00:00:00.000Z',
      },
      {
        itemId: 'workflow-message-2',
        sessionId: 'review-session-2',
        messageRole: 'assistant',
        content: 'Workflow looks good',
        timestamp: '2026-01-03T00:01:00.000Z',
      },
    ])

    mockOrderBySessions.mockResolvedValue([
      {
        id: 'review-session-2',
        userId: 'creator-user',
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: 'workflow-1',
        draftSessionId: null,
        title: 'Workflow review',
        model: 'claude-4.5-sonnet',
        conversationId: 'conversation-2',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
      },
    ])

    mockMapReviewItemToApi.mockImplementation((row: any) => ({
      id: row.itemId,
      role: row.messageRole,
      content: row.content,
      timestamp: row.timestamp,
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: mockSelect,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      copilotReviewItems: {
        sessionId: 'sessionId',
        sequence: 'sequence',
        kind: 'kind',
      },
      copilotReviewSessions: {
        id: 'id',
        userId: 'userId',
        workspaceId: 'workspaceId',
        entityKind: 'entityKind',
        entityId: 'entityId',
        draftSessionId: 'draftSessionId',
        title: 'title',
        model: 'model',
        conversationId: 'conversationId',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      asc: vi.fn((field) => ({ field, type: 'asc' })),
      count: vi.fn(() => ({ type: 'count' })),
      desc: vi.fn((field) => ({ field, type: 'desc' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      inArray: vi.fn((field, values) => ({ field, values, type: 'inArray' })),
      sql: vi.fn(() => ({ type: 'sql' })),
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({ user: { id: 'collaborator-user' } }),
    }))

    vi.doMock('@/lib/copilot/auth', () => ({
      authenticateCopilotRequestSessionOnly: vi.fn().mockResolvedValue({
        userId: 'collaborator-user',
        isAuthenticated: true,
      }),
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

    vi.doMock('@/lib/copilot/agent/utils', () => ({
      requestCopilotTitle: vi.fn(),
    }))

    vi.doMock('@/lib/copilot/config', () => ({
      getCopilotModel: vi.fn(),
    }))

    vi.doMock('@/lib/copilot/review-sessions/thread-history', () => ({
      buildAppendReviewTurn: vi.fn(),
      MESSAGE_ROLES: {
        USER: 'user',
        ASSISTANT: 'assistant',
        SYSTEM: 'system',
      },
      REVIEW_ITEM_KINDS: {
        MESSAGE: 'message',
      },
      mapReviewItemToApi: mockMapReviewItemToApi,
    }))

    vi.doMock('@/lib/copilot/review-sessions/permissions', () => ({
      loadReviewSessionForUser: mockLoadReviewSessionForUser,
    }))

    vi.doMock('@/lib/copilot/review-sessions/types', () => ({
      REVIEW_ENTITY_KINDS: ['workflow', 'skill', 'custom_tool', 'mcp_server', 'indicator'],
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        COPILOT_API_URL: 'http://localhost:8000',
        COPILOT_API_KEY: 'test-key',
        BETTER_AUTH_URL: 'http://localhost:3000',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
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

    vi.doMock('@/lib/uploads', () => ({
      CopilotFiles: {
        processCopilotAttachments: vi.fn().mockResolvedValue([]),
      },
    }))

    vi.doMock('@/lib/uploads/utils/file-utils', () => ({
      createFileContent: vi.fn(),
    }))

    vi.doMock('@/app/api/copilot/proxy', () => ({
      proxyCopilotRequest: vi.fn(),
    }))

  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('loads a shared saved-entity review session for a collaborator', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/copilot/chat?reviewSessionId=review-session-1'
    )

    const { GET } = await import('@/app/api/copilot/chat/route')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({
      success: true,
      chats: [
        {
          reviewSessionId: 'review-session-1',
          workspaceId: 'workspace-1',
          entityKind: 'skill',
          entityId: 'skill-1',
          draftSessionId: null,
          title: 'Shared skill review',
          reviewModel: 'claude-4.5-sonnet',
          messages: [
            {
              id: 'message-1',
              role: 'user',
              content: 'Please review this skill',
              timestamp: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'message-2',
              role: 'assistant',
              content: 'Looks good',
              timestamp: '2026-01-01T00:01:00.000Z',
            },
          ],
          messageCount: 2,
          conversationId: 'conversation-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })

    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'review-session-1',
      'collaborator-user'
    )
  })

  it('hydrates messages for workflow review session lists', async () => {
    const request = new NextRequest('http://localhost:3000/api/copilot/chat?workflowId=workflow-1')

    const { GET } = await import('@/app/api/copilot/chat/route')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({
      success: true,
      chats: [
        {
          reviewSessionId: 'review-session-2',
          workspaceId: 'workspace-1',
          entityKind: 'workflow',
          entityId: 'workflow-1',
          draftSessionId: null,
          title: 'Workflow review',
          reviewModel: 'claude-4.5-sonnet',
          messages: [
            {
              id: 'workflow-message-1',
              role: 'user',
              content: 'Please review this workflow',
              timestamp: '2026-01-03T00:00:00.000Z',
            },
            {
              id: 'workflow-message-2',
              role: 'assistant',
              content: 'Workflow looks good',
              timestamp: '2026-01-03T00:01:00.000Z',
            },
          ],
          messageCount: 2,
          conversationId: 'conversation-2',
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-04T00:00:00.000Z',
        },
      ],
    })

    expect(mockSelect).toHaveBeenCalledTimes(2)
  })
})
