/**
 * @vitest-environment node
 */
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Copilot Chat Update Messages Review Sessions', () => {
  const mockAuthenticate = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()
  const mockTransaction = vi.fn()
  const mockSelect = vi.fn()

  const selectFrom = vi.fn()
  const selectWhere = vi.fn()
  const selectOrderBy = vi.fn()
  const deleteWhere = vi.fn()
  const deleteFn = vi.fn(() => ({ where: deleteWhere }))
  const insertValues = vi.fn().mockResolvedValue(undefined)
  const insertFn = vi.fn(() => ({ values: insertValues }))
  const updateWhere = vi.fn()
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const updateFn = vi.fn(() => ({ set: updateSet }))

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()

    mockAuthenticate.mockResolvedValue({
      userId: 'collaborator-user',
      isAuthenticated: true,
    })

    mockSelect.mockReturnValue({ from: selectFrom })
    selectFrom.mockReturnValue({ where: selectWhere })
    selectWhere.mockReturnValue({ orderBy: selectOrderBy })
    selectOrderBy.mockResolvedValue([
      {
        itemId: 'message-1',
        sessionId: 'review-session-1',
        messageRole: 'user',
        content: 'Please update this draft',
        timestamp: '2026-03-30T12:00:00.000Z',
      },
      {
        itemId: 'message-2',
        sessionId: 'review-session-1',
        messageRole: 'assistant',
        content: 'Updated draft saved.',
        timestamp: '2026-03-30T12:00:01.000Z',
      },
      {
        itemId: 'message-3',
        sessionId: 'review-session-1',
        messageRole: 'user',
        content: 'Collaborator note added after load',
        timestamp: '2026-03-30T12:00:02.000Z',
      },
    ])

    deleteWhere.mockResolvedValue(undefined)
    updateWhere.mockResolvedValue(undefined)

    mockTransaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        select: mockSelect,
        delete: deleteFn,
        insert: insertFn,
        update: updateFn,
      })
    )

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        transaction: mockTransaction,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      copilotReviewItems: {
        sessionId: 'copilot_review_items.session_id',
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
      eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
    }))

    vi.doMock('@/lib/copilot/auth', () => ({
      authenticateCopilotRequestSessionOnly: mockAuthenticate,
      createInternalServerErrorResponse: vi.fn((message: string) =>
        NextResponse.json({ error: message }, { status: 500 })
      ),
      createNotFoundResponse: vi.fn((message: string) =>
        NextResponse.json({ error: message }, { status: 404 })
      ),
      createRequestTracker: vi.fn(() => ({
        requestId: 'request-1',
        getDuration: () => 0,
      })),
      createUnauthorizedResponse: vi.fn(() =>
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      ),
    }))

    vi.doMock('@/lib/copilot/review-sessions/permissions', () => ({
      loadReviewSessionForUser: mockLoadReviewSessionForUser,
    }))

    vi.doMock('@/lib/copilot/review-sessions/thread-history', () => ({
      deriveReviewTurnsAndItems: vi.fn((reviewSessionId: string, messages: any[]) => {
        const turns: any[] = []
        const items: any[] = []
        let currentTurnId: string | null = null
        let currentTurnIndex = -1

        messages.forEach((message, index) => {
          const shouldStartNewTurn = currentTurnId === null || message.role === 'user'
          if (shouldStartNewTurn) {
            currentTurnId = `turn-${turns.length + 1}`
            currentTurnIndex += 1
            turns.push({
              id: currentTurnId,
              sessionId: reviewSessionId,
              sequence: currentTurnIndex,
              status: 'completed',
              userMessageItemId: message.role === 'user' ? message.id : null,
            })
          } else if (currentTurnId && currentTurnIndex >= 0) {
            turns[currentTurnIndex] = {
              ...turns[currentTurnIndex],
            }
          }

          items.push({
            sessionId: reviewSessionId,
            turnId: currentTurnId,
            sequence: index,
            itemId: message.id,
            kind: 'message',
            messageRole: message.role,
            content: message.content,
            timestamp: message.timestamp,
          })
        })

        return { turns, items }
      }),
      mapReviewItemToApi: vi.fn((row: any) => ({
        id: row.itemId,
        role: row.messageRole,
        content: row.content,
        timestamp: row.timestamp,
      })),
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

  it('allows a collaborator to update messages for a shared saved-entity review session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
    })

    const request = createMockRequest('POST', {
      reviewSessionId: 'review-session-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'Please update this draft',
          timestamp: '2026-03-30T12:00:00.000Z',
        },
        {
          id: 'message-2',
          role: 'assistant',
          content: 'Updated draft saved.',
          timestamp: '2026-03-30T12:00:01.000Z',
        },
      ],
    })

    const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      messageCount: 3,
    })

    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'review-session-1',
      'collaborator-user',
      { requireWrite: true }
    )
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(2)
    expect(insertValues).toHaveBeenCalledTimes(2)
    expect(insertValues).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'review-session-1',
          sequence: 0,
          status: 'completed',
          userMessageItemId: 'message-1',
        }),
        expect.objectContaining({
          sessionId: 'review-session-1',
          sequence: 1,
          status: 'completed',
          userMessageItemId: 'message-3',
        }),
      ])
    )
    expect(insertValues).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'review-session-1',
          itemId: 'message-1',
          sequence: 0,
          messageRole: 'user',
          content: 'Please update this draft',
          timestamp: '2026-03-30T12:00:00.000Z',
        }),
        expect.objectContaining({
          sessionId: 'review-session-1',
          itemId: 'message-2',
          sequence: 1,
          messageRole: 'assistant',
          content: 'Updated draft saved.',
          timestamp: '2026-03-30T12:00:01.000Z',
        }),
        expect.objectContaining({
          sessionId: 'review-session-1',
          itemId: 'message-3',
          sequence: 2,
          messageRole: 'user',
          content: 'Collaborator note added after load',
          timestamp: '2026-03-30T12:00:02.000Z',
        }),
      ])
    )
  })

  it('returns not found when the caller cannot access the review session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue(null)

    const request = createMockRequest('POST', {
      reviewSessionId: 'review-session-1',
      messages: [],
    })

    const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
    const response = await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Review session not found or unauthorized',
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
