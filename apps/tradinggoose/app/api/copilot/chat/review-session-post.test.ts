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
  const mockDelete = vi.fn()
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined)
  const mockTransaction = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()
  const mockProxyCopilotRequest = vi.fn()
  const mockProcessContextsServer = vi.fn()
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
  const selectLimit = vi.fn()
  const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy, limit: selectLimit }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const txSelectOrderBy = vi.fn()
  const txSelectWhere = vi.fn(() => ({ orderBy: txSelectOrderBy }))
  const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }))
  const txSelect = vi.fn(() => ({ from: txSelectFrom }))
  const mockInsertReturning = vi.fn()
  const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }))
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }))

  const txInsertValues = vi.fn().mockResolvedValue(undefined)
  const txInsert = vi.fn(() => ({ values: txInsertValues }))
  const txUpdateWhere = vi.fn().mockResolvedValue(undefined)
  const txUpdateSet = vi.fn(() => ({ where: txUpdateWhere }))
  const txUpdate = vi.fn(() => ({ set: txUpdateSet }))

  function createSseStream(events: unknown[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        }
        controller.close()
      },
    })
  }

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()

    mockAuth({
      id: 'collaborator-user',
      email: 'collaborator@example.com',
      name: 'Collaborator',
    }).setAuthenticated()

    selectOrderBy.mockResolvedValue([])
    selectLimit.mockResolvedValue([])
    txSelectOrderBy.mockResolvedValue([])
    mockSelect.mockReturnValue({ from: selectFrom })
    mockInsertReturning.mockResolvedValue([])
    mockDelete.mockReturnValue({ where: mockDeleteWhere })

    mockTransaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        select: txSelect,
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
        insert: mockInsert,
        delete: mockDelete,
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
        userId: 'copilot_review_sessions.user_id',
        entityKind: 'copilot_review_sessions.entity_kind',
        channelId: 'copilot_review_sessions.channel_id',
        workspaceId: 'copilot_review_sessions.workspace_id',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
      asc: vi.fn((field: unknown) => ({ field, type: 'asc' })),
      desc: vi.fn((field: unknown) => ({ field, type: 'desc' })),
      eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
      inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values, type: 'inArray' })),
      isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
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

    vi.doMock('@/lib/copilot/config', () => ({
      getCopilotModel: vi.fn(() => ({
        model: 'claude-sonnet-4.6',
      })),
    }))

    vi.doMock('@/lib/copilot/agent/utils', () => ({
      requestCopilotTitle: vi.fn().mockResolvedValue(null),
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
        COPILOT_PROVIDER: 'anthropic',
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

    vi.doMock('@/lib/utils', async () => {
      const actual = await vi.importActual<typeof import('@/lib/utils')>('@/lib/utils')
      return {
        ...actual,
        encodeSSE: vi.fn((event: unknown) =>
          new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
        ),
        SSE_HEADERS: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      }
    })

    vi.doMock('@/app/api/copilot/proxy', () => ({
      proxyCopilotRequest: mockProxyCopilotRequest,
    }))

    vi.doMock('@/lib/copilot/process-contents', () => ({
      processContextsServer: mockProcessContextsServer,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('persists a collaborator reply on an existing shared saved-entity session', async () => {
    mockProcessContextsServer.mockResolvedValue([])
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
      model: 'gpt-5.4',
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
        model: 'gpt-5.4',
        provider: {
          provider: 'openai',
          model: 'gpt-5.4',
          apiKey: 'test-copilot-key',
        },
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

  it('persists non-streaming tool-only assistant turns', async () => {
    mockProcessContextsServer.mockResolvedValue([])
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
      title: 'Shared skill review',
      conversationId: null,
    })
    mockProxyCopilotRequest.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: '',
        toolCalls: [
          {
            id: 'tool-call-1',
            name: 'lookup_context',
            success: true,
            result: { ok: true },
          },
        ],
      }),
    })

    const request = createMockRequest('POST', {
      message: 'Use the tool output only',
      reviewSessionId: 'review-session-1',
      model: 'gpt-5.4',
      stream: false,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewSessionId: 'review-session-1',
    })
    expect(txInsertValues).toHaveBeenCalledTimes(2)
    expect(mockBuildAppendReviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewSessionId: 'review-session-1',
        assistantMessage: expect.objectContaining({
          content: '',
          toolCalls: [
            {
              id: 'tool-call-1',
              name: 'lookup_context',
              success: true,
              result: { ok: true },
            },
          ],
        }),
      })
    )
  })

  it('accepts live entity contexts and forwards processed supporting context to copilot', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
      title: 'Shared skill review',
      conversationId: null,
    })
    mockProcessContextsServer.mockResolvedValue([
      {
        type: 'current_indicator',
        tag: '@Current Indicator',
        content: '{"id":"indicator-1"}',
      },
    ])
    mockProxyCopilotRequest.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: 'Context-aware response',
      }),
    })

    const request = createMockRequest('POST', {
      message: 'Update the current indicator',
      reviewSessionId: 'review-session-1',
      workspaceId: 'workspace-1',
      stream: false,
      contexts: [
        {
          kind: 'current_indicator',
          indicatorId: 'indicator-1',
          workspaceId: 'workspace-1',
          label: 'Current Indicator',
        },
      ],
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockProcessContextsServer).toHaveBeenCalledWith(
      [
        {
          kind: 'current_indicator',
          indicatorId: 'indicator-1',
          workspaceId: 'workspace-1',
          label: 'Current Indicator',
        },
      ],
      'collaborator-user',
      'Update the current indicator',
      'workspace-1'
    )
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith({
      endpoint: '/api/copilot',
      body: expect.objectContaining({
        message: 'Update the current indicator',
        userId: 'collaborator-user',
        model: 'claude-sonnet-4.6',
        chatId: 'review-session-1',
        context: [
          {
            type: 'current_indicator',
            tag: '@Current Indicator',
            content: '{"id":"indicator-1"}',
          },
        ],
      }),
    })
  })

  it('preserves tool-call metadata for non-streaming text responses', async () => {
    mockProcessContextsServer.mockResolvedValue([])
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
      title: 'Shared skill review',
      conversationId: null,
    })
    mockProxyCopilotRequest.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: 'Saved response',
        toolCalls: [
          {
            id: 'tool-call-1',
            name: 'lookup_context',
            success: true,
            result: { ok: true },
          },
        ],
      }),
    })

    const request = createMockRequest('POST', {
      message: 'Summarize the tool result',
      reviewSessionId: 'review-session-1',
      model: 'gpt-5.4',
      stream: false,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewSessionId: 'review-session-1',
    })
    expect(txInsertValues).toHaveBeenCalledTimes(2)
    expect(mockBuildAppendReviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewSessionId: 'review-session-1',
        assistantMessage: expect.objectContaining({
          content: 'Saved response',
          toolCalls: [
            {
              id: 'tool-call-1',
              name: 'lookup_context',
              success: true,
              result: { ok: true },
            },
          ],
        }),
      })
    )
  })

  it('derives append sequences from the latest in-transaction session history', async () => {
    mockProcessContextsServer.mockResolvedValue([])
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
      title: 'Shared skill review',
      conversationId: null,
    })
    txSelectOrderBy.mockResolvedValue([
      {
        itemId: 'message-existing',
        messageRole: 'user',
        content: 'Collaborator message',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ])

    const request = createMockRequest('POST', {
      message: 'Please update the summary',
      reviewSessionId: 'review-session-1',
      stream: false,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(txSelect).toHaveBeenCalledTimes(1)
    expect(mockBuildAppendReviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewSessionId: 'review-session-1',
        existingMessages: [
          {
            itemId: 'message-existing',
            messageRole: 'user',
            content: 'Collaborator message',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    )
  })

  it('returns 404 when the supplied reviewSessionId cannot be loaded', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue(null)

    const request = createMockRequest('POST', {
      message: 'Please update the summary',
      reviewSessionId: 'review-session-missing',
      stream: false,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Review session not found or unauthorized',
    })
    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'review-session-missing',
      'collaborator-user'
    )
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockProxyCopilotRequest).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('creates a fresh generic copilot session for the current panel channel', async () => {
    mockProcessContextsServer.mockResolvedValue([])
    mockInsertReturning.mockResolvedValueOnce([
      {
        id: 'review-session-channel-1',
        userId: 'collaborator-user',
        workspaceId: 'workspace-1',
        channelId: 'copilot-panel-1',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: null,
        model: 'claude-sonnet-4.6',
        conversationId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const request = createMockRequest('POST', {
      message: 'Start a fresh generic copilot chat',
      channelId: 'copilot-panel-1',
      workspaceId: 'workspace-1',
      model: 'claude-sonnet-4.6',
      stream: false,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewSessionId: 'review-session-channel-1',
    })
    expect(mockLoadReviewSessionForUser).not.toHaveBeenCalled()
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'collaborator-user',
        entityKind: 'copilot',
        workspaceId: 'workspace-1',
        channelId: 'copilot-panel-1',
      })
    )
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith({
      endpoint: '/api/copilot',
      body: expect.objectContaining({
        message: 'Start a fresh generic copilot chat',
        userId: 'collaborator-user',
        model: 'claude-sonnet-4.6',
        chatId: 'review-session-channel-1',
      }),
    })
  })

  it('creates a new generic copilot session even when older chats already exist for the same panel channel', async () => {
    mockProcessContextsServer.mockResolvedValue([])
    mockInsertReturning.mockResolvedValueOnce([
      {
        id: 'review-session-channel-newer',
        userId: 'collaborator-user',
        workspaceId: 'workspace-1',
        channelId: 'copilot-panel-1',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: null,
        model: 'claude-sonnet-4.6',
        conversationId: null,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ])

    const request = createMockRequest('POST', {
      message: 'Create another chat in the same panel',
      channelId: 'copilot-panel-1',
      workspaceId: 'workspace-1',
      model: 'claude-sonnet-4.6',
      stream: false,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewSessionId: 'review-session-channel-newer',
    })
    expect(selectLimit).not.toHaveBeenCalled()
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'collaborator-user',
        entityKind: 'copilot',
        workspaceId: 'workspace-1',
        channelId: 'copilot-panel-1',
      })
    )
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith({
      endpoint: '/api/copilot',
      body: expect.objectContaining({
        message: 'Create another chat in the same panel',
        chatId: 'review-session-channel-newer',
      }),
    })
  })

  it('keeps a newly created panel-scoped generic copilot chat when a streamed reply ends without assistant content', async () => {
    mockProcessContextsServer.mockResolvedValue([])
    mockInsertReturning.mockResolvedValueOnce([
      {
        id: 'review-session-channel-empty',
        userId: 'collaborator-user',
        workspaceId: 'workspace-1',
        channelId: 'copilot-panel-empty',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: null,
        model: 'claude-sonnet-4.6',
        conversationId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    mockProxyCopilotRequest.mockResolvedValueOnce({
      ok: true,
      body: createSseStream([{ type: 'done' }]),
    })

    const request = createMockRequest('POST', {
      message: 'Keep my user message even if the assistant is empty',
      channelId: 'copilot-panel-empty',
      workspaceId: 'workspace-1',
      model: 'claude-sonnet-4.6',
      stream: true,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    await response.text()

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(txInsertValues).toHaveBeenCalledTimes(2)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('does not delete an existing generic copilot chat selected by reviewSessionId after an empty streamed reply', async () => {
    mockProcessContextsServer.mockResolvedValue([])
    mockLoadReviewSessionForUser.mockResolvedValueOnce({
      id: 'review-session-existing-scope',
      userId: 'collaborator-user',
      workspaceId: 'workspace-1',
      channelId: 'copilot-panel-existing',
      entityKind: 'copilot',
      entityId: null,
      draftSessionId: null,
      title: 'Existing panel-scoped generic copilot chat',
      model: 'claude-sonnet-4.6',
      conversationId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    mockProxyCopilotRequest.mockResolvedValueOnce({
      ok: true,
      body: createSseStream([{ type: 'done' }]),
    })

    const request = createMockRequest('POST', {
      message: 'Do not wipe existing history on an empty reply',
      reviewSessionId: 'review-session-existing-scope',
      model: 'claude-sonnet-4.6',
      stream: true,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    await response.text()

    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
