/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Copilot Chats List API Route', () => {
  const mockSelect = vi.fn()
  const mockFromSessions = vi.fn()
  const mockWhereSessions = vi.fn()
  const mockOrderBySessions = vi.fn()
  const mockFromItems = vi.fn()
  const mockWhereItems = vi.fn()
  const mockGroupByItems = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()
  const mockVerifyReviewTargetAccess = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()

    mockSelect.mockImplementation((selection?: Record<string, unknown>) => {
      if (selection && 'id' in selection) {
        return { from: mockFromSessions }
      }

      return { from: mockFromItems }
    })
    mockFromSessions.mockReturnValue({ where: mockWhereSessions })
    mockWhereSessions.mockReturnValue({ orderBy: mockOrderBySessions })
    mockFromItems.mockReturnValue({ where: mockWhereItems })
    mockWhereItems.mockReturnValue({ groupBy: mockGroupByItems })
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
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'write',
      workspaceId: 'workspace-1',
      isOwner: false,
    })
    mockOrderBySessions.mockResolvedValue([])
    mockGroupByItems.mockResolvedValue([{ sessionId: 'review-session-1', count: 2 }])

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: mockSelect,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      copilotReviewItems: {
        sessionId: 'sessionId',
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
      count: vi.fn(() => ({ type: 'count' })),
      desc: vi.fn((field) => ({ field, type: 'desc' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      inArray: vi.fn((field, values) => ({ field, values, type: 'inArray' })),
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
      createUnauthorizedResponse: vi.fn(() =>
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      ),
    }))

    vi.doMock('@/lib/copilot/review-sessions/permissions', () => ({
      loadReviewSessionForUser: mockLoadReviewSessionForUser,
      verifyReviewTargetAccess: mockVerifyReviewTargetAccess,
    }))

    vi.doMock('@/lib/copilot/review-sessions/thread-history', () => ({
      REVIEW_ITEM_KINDS: {
        MESSAGE: 'message',
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
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('returns a shared review session for a collaborator with workspace access', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/copilot/chats?reviewSessionId=review-session-1'
    )

    const { GET } = await import('@/app/api/copilot/chats/route')
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
          messages: [],
          conversationId: 'conversation-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          messageCount: 2,
        },
      ],
    })

    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'review-session-1',
      'collaborator-user'
    )
  })

  it('returns 404 when the caller cannot access the review session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValueOnce(null)

    const request = new NextRequest(
      'http://localhost:3000/api/copilot/chats?reviewSessionId=review-session-1'
    )

    const { GET } = await import('@/app/api/copilot/chats/route')
    const response = await GET(request)

    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload).toEqual({ error: 'Review session not found or unauthorized' })
  })

  it('lists entity review sessions when reviewSessionId is provided alongside entity filters', async () => {
    mockOrderBySessions.mockResolvedValueOnce([
      {
        id: 'review-session-1',
        userId: 'creator-user',
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        title: 'Shared skill review',
        reviewModel: 'claude-4.5-sonnet',
        conversationId: 'conversation-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'review-session-2',
        userId: 'another-user',
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        title: 'Older shared skill review',
        reviewModel: 'gpt-5-fast',
        conversationId: 'conversation-2',
        createdAt: new Date('2025-12-31T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    mockGroupByItems.mockResolvedValueOnce([
      { sessionId: 'review-session-1', count: 2 },
      { sessionId: 'review-session-2', count: 1 },
    ])

    const request = new NextRequest(
      'http://localhost:3000/api/copilot/chats?reviewSessionId=review-session-1&entityKind=skill&entityId=skill-1&workspaceId=workspace-1'
    )

    const { GET } = await import('@/app/api/copilot/chats/route')
    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
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
          messages: [],
          messageCount: 2,
          conversationId: 'conversation-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          reviewSessionId: 'review-session-2',
          workspaceId: 'workspace-1',
          entityKind: 'skill',
          entityId: 'skill-1',
          draftSessionId: null,
          title: 'Older shared skill review',
          reviewModel: 'gpt-5-fast',
          messages: [],
          messageCount: 1,
          conversationId: 'conversation-2',
          createdAt: '2025-12-31T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    expect(mockLoadReviewSessionForUser).not.toHaveBeenCalled()
    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledWith('collaborator-user', {
      entityKind: 'skill',
      entityId: 'skill-1',
      draftSessionId: null,
      reviewSessionId: 'review-session-1',
      workspaceId: 'workspace-1',
    })
  })
})
