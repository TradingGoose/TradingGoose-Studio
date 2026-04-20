/**
 * @vitest-environment node
 */
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'
import { EDIT_REPLAY_BLOCKED_MESSAGE } from '@/lib/copilot/chat-replay-safety'

describe('Copilot Chat Update Messages', () => {
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
            ...(Array.isArray(message.toolCalls) ? { toolCalls: message.toolCalls } : {}),
            ...(Array.isArray(message.contentBlocks)
              ? { contentBlocks: message.contentBlocks }
              : {}),
            ...(Array.isArray(message.contexts) ? { contexts: message.contexts } : {}),
            ...(Array.isArray(message.citations) ? { citations: message.citations } : {}),
            ...(Array.isArray(message.fileAttachments)
              ? { fileAttachments: message.fileAttachments }
              : {}),
          })
        })

        return { turns, items }
      }),
      mapReviewItemToApi: vi.fn((row: any) => ({
        id: row.itemId,
        role: row.messageRole,
        content: row.content,
        timestamp: row.timestamp,
        ...(Array.isArray(row.toolCalls) ? { toolCalls: row.toolCalls } : {}),
        ...(Array.isArray(row.contentBlocks) ? { contentBlocks: row.contentBlocks } : {}),
        ...(Array.isArray(row.contexts) ? { contexts: row.contexts } : {}),
        ...(Array.isArray(row.citations) ? { citations: row.citations } : {}),
        ...(Array.isArray(row.fileAttachments) ? { fileAttachments: row.fileAttachments } : {}),
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

  it('updates messages for a generic copilot chat session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      entityKind: 'copilot',
      entityId: null,
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
      messageCount: 2,
    })

    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'review-session-1',
      'collaborator-user',
      { requireWrite: true }
    )
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(2)
    expect(insertValues).toHaveBeenCalledTimes(2)
    expect(updateWhere).toHaveBeenCalledTimes(2)
  })

  it('rewrites generic copilot chat messages exactly', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'collaborator-user',
      entityKind: 'copilot',
      entityId: null,
      workspaceId: 'workspace-1',
    })

    const request = createMockRequest('POST', {
      reviewSessionId: 'review-session-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'Please update this draft with owner edits',
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
      messageCount: 2,
    })

    expect(deleteWhere).toHaveBeenCalledTimes(2)
    expect(insertValues).toHaveBeenCalledTimes(2)
    expect(updateWhere).toHaveBeenCalledTimes(2)
    expect(insertValues.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        itemId: 'message-1',
        content: 'Please update this draft with owner edits',
      }),
      expect.objectContaining({
        itemId: 'message-2',
        content: 'Updated draft saved.',
      }),
    ])
  })

  it('uses exact rewrite mode for edit replay truncation', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'collaborator-user',
      entityKind: 'copilot',
      entityId: null,
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
      ],
    })

    const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      messageCount: 1,
    })

    expect(deleteWhere).toHaveBeenCalledTimes(2)
    expect(insertValues).toHaveBeenCalledTimes(2)
    expect(updateWhere).toHaveBeenCalledTimes(2)
    expect(insertValues.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        itemId: 'message-1',
        content: 'Please update this draft',
      }),
    ])
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

  it('rejects entity-bound sessions for generic copilot chat rewrites', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'collaborator-user',
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
    })

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

  it('rejects rewrites that would drop later accepted workflow mutations', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'collaborator-user',
      entityKind: 'copilot',
      entityId: null,
      workspaceId: 'workspace-1',
    })

    selectOrderBy.mockResolvedValueOnce([
      {
        itemId: 'message-1',
        sessionId: 'review-session-1',
        messageRole: 'user',
        content: 'Update the workflow',
        timestamp: '2026-03-30T12:00:00.000Z',
      },
      {
        itemId: 'message-2',
        sessionId: 'review-session-1',
        messageRole: 'assistant',
        content: '',
        timestamp: '2026-03-30T12:00:01.000Z',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'edit_workflow',
            state: 'success',
          },
        ],
        contentBlocks: [
          {
            type: 'tool_call',
            timestamp: 1,
            toolCall: {
              id: 'tool-1',
              name: 'edit_workflow',
              state: 'success',
            },
          },
        ],
      },
      {
        itemId: 'message-3',
        sessionId: 'review-session-1',
        messageRole: 'user',
        content: 'Follow-up after the workflow edit',
        timestamp: '2026-03-30T12:00:02.000Z',
      },
    ])

    const request = createMockRequest('POST', {
      reviewSessionId: 'review-session-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'Update the workflow, but differently',
          timestamp: '2026-03-30T12:00:00.000Z',
        },
      ],
    })

    const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: EDIT_REPLAY_BLOCKED_MESSAGE,
    })
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
    expect(updateWhere).toHaveBeenCalledTimes(1)
  })

  it('rejects rewrites that would drop later accepted shared-entity mutations', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'collaborator-user',
      entityKind: 'copilot',
      entityId: null,
      workspaceId: 'workspace-1',
    })

    selectOrderBy.mockResolvedValueOnce([
      {
        itemId: 'message-1',
        sessionId: 'review-session-1',
        messageRole: 'user',
        content: 'Edit the skill',
        timestamp: '2026-03-30T12:00:00.000Z',
      },
      {
        itemId: 'message-2',
        sessionId: 'review-session-1',
        messageRole: 'assistant',
        content: '',
        timestamp: '2026-03-30T12:00:01.000Z',
        toolCalls: [
          {
            id: 'tool-entity-1',
            name: 'edit_skill',
            state: 'success',
            params: {
              entityDocument: '{}',
            },
          },
        ],
        contentBlocks: [
          {
            type: 'tool_call',
            timestamp: 1,
            toolCall: {
              id: 'tool-entity-1',
              name: 'edit_skill',
              state: 'success',
              result: {},
            },
          },
        ],
      },
      {
        itemId: 'message-3',
        sessionId: 'review-session-1',
        messageRole: 'user',
        content: 'Follow-up after the skill edit',
        timestamp: '2026-03-30T12:00:02.000Z',
      },
    ])

    const request = createMockRequest('POST', {
      reviewSessionId: 'review-session-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'Edit the skill differently',
          timestamp: '2026-03-30T12:00:00.000Z',
        },
      ],
    })

    const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: EDIT_REPLAY_BLOCKED_MESSAGE,
    })
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
    expect(updateWhere).toHaveBeenCalledTimes(1)
  })

  it('persists tool-state-only message updates when ids and text stay the same', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'collaborator-user',
      entityKind: 'copilot',
      entityId: null,
      workspaceId: 'workspace-1',
    })

    selectOrderBy.mockResolvedValueOnce([
      {
        itemId: 'message-1',
        sessionId: 'review-session-1',
        messageRole: 'assistant',
        content: '',
        timestamp: '2026-03-30T12:00:01.000Z',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'edit_workflow',
            state: 'pending',
          },
        ],
        contentBlocks: [
          {
            type: 'tool_call',
            timestamp: 1,
            toolCall: {
              id: 'tool-1',
              name: 'edit_workflow',
              state: 'pending',
            },
          },
        ],
      },
    ])

    const request = createMockRequest('POST', {
      reviewSessionId: 'review-session-1',
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          content: '',
          timestamp: '2026-03-30T12:00:01.000Z',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'edit_workflow',
              state: 'rejected',
            },
          ],
          contentBlocks: [
            {
              type: 'tool_call',
              timestamp: 1,
              toolCall: {
                id: 'tool-1',
                name: 'edit_workflow',
                state: 'rejected',
              },
            },
          ],
        },
      ],
    })

    const { POST } = await import('@/app/api/copilot/chat/update-messages/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      messageCount: 1,
    })
    expect(deleteWhere).toHaveBeenCalledTimes(2)
    expect(insertValues).toHaveBeenCalledTimes(2)
    expect(updateWhere).toHaveBeenCalledTimes(2)
    expect(insertValues.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        itemId: 'message-1',
        toolCalls: [
          expect.objectContaining({
            id: 'tool-1',
            state: 'rejected',
          }),
        ],
        contentBlocks: [
          expect.objectContaining({
            type: 'tool_call',
            toolCall: expect.objectContaining({
              id: 'tool-1',
              state: 'rejected',
            }),
          }),
        ],
      }),
    ])
  })
})
