/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Copilot Chat POST Generic Sessions', () => {
  const mockSelect = vi.fn()
  const mockDelete = vi.fn()
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined)
  const mockTransaction = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()
  const mockProxyCopilotRequest = vi.fn()
  const mockProcessContextsServer = vi.fn()
  const mockRequestCopilotTitle = vi.fn().mockResolvedValue(null)
  const mockMirrorLocalCopilotCompletionUsageReports = vi.fn()
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
  const mockDeriveReviewTurnsAndItems = vi.fn(() => ({
    turns: [
      {
        id: 'turn-rewritten-1',
        sessionId: 'review-session-1',
        sequence: 0,
        status: 'completed',
        userMessageItemId: 'user-message-duplicate',
      },
    ],
    items: [
      {
        sessionId: 'review-session-1',
        turnId: 'turn-rewritten-1',
        sequence: 0,
        itemId: 'user-message-duplicate',
        kind: 'message',
        messageRole: 'user',
        content: 'Please update the summary',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        sessionId: 'review-session-1',
        turnId: 'turn-rewritten-1',
        sequence: 1,
        itemId: 'assistant-message-rewritten',
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
  const txDeleteWhere = vi.fn().mockResolvedValue(undefined)
  const txDelete = vi.fn(() => ({ where: txDeleteWhere }))
  const mockInsertReturning = vi.fn()
  const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }))
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }))

  const buildExistingReviewSession = (overrides: Record<string, unknown> = {}) => ({
    id: 'review-session-1',
    userId: 'creator-user',
    entityKind: 'copilot',
    entityId: null,
    workspaceId: 'workspace-1',
    title: 'Shared skill review',
    conversationId: null,
    ...overrides,
  })

  const buildPersistedReviewSession = (id: string, title: string) => ({
    id,
    userId: 'collaborator-user',
    workspaceId: 'workspace-1',
    entityKind: 'copilot',
    entityId: null,
    draftSessionId: null,
    title,
    model: 'anthropic/claude-fable-5',
    conversationId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  })

  const txInsertValues = vi.fn().mockResolvedValue(undefined)
  const txInsert = vi.fn(() => ({ values: txInsertValues }))
  const txUpdateWhere = vi.fn().mockResolvedValue(undefined)
  const txUpdateSet = vi.fn(() => ({ where: txUpdateWhere }))
  const txUpdate = vi.fn(() => ({ set: txUpdateSet }))

  function createSseStream(events: unknown[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
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
        delete: txDelete,
      })
    )

    mockProxyCopilotRequest.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: 'Saved response',
      }),
    })
    mockLoadReviewSessionForUser.mockResolvedValue(buildExistingReviewSession())
    mockProcessContextsServer.mockResolvedValue([])

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

    vi.doMock('@/lib/copilot/completion-usage-billing', () => ({
      mirrorLocalCopilotCompletionUsageReports: mockMirrorLocalCopilotCompletionUsageReports,
    }))

    vi.doMock('@/lib/copilot/agent/utils', () => ({
      requestCopilotTitle: mockRequestCopilotTitle,
    }))

    vi.doMock('@/lib/copilot/review-sessions/thread-history', () => ({
      buildAppendReviewTurn: mockBuildAppendReviewTurn,
      deriveReviewTurnsAndItems: mockDeriveReviewTurnsAndItems,
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
      ENTITY_KIND_CUSTOM_TOOL: 'custom_tool',
      ENTITY_KIND_DASHBOARD_LAYOUT: 'dashboard_layout',
      ENTITY_KIND_INDICATOR: 'indicator',
      ENTITY_KIND_KNOWLEDGE_BASE: 'knowledge_base',
      ENTITY_KIND_MCP_SERVER: 'mcp_server',
      ENTITY_KIND_SKILL: 'skill',
      ENTITY_KIND_WATCHLIST: 'watchlist',
      ENTITY_KIND_WORKFLOW: 'workflow',
      REVIEW_ENTITY_KINDS: [
        'workflow',
        'skill',
        'custom_tool',
        'mcp_server',
        'indicator',
        'knowledge_base',
      ],
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

    vi.doMock('@/lib/copilot/runtime-tool-manifest', () => ({
      getCopilotRuntimeToolManifest: vi.fn().mockResolvedValue({
        version: 'v1',
        tools: [{ name: 'read_workflow' }, { name: 'edit_workflow' }],
      }),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('persists a collaborator reply on an existing generic copilot session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValueOnce(
      buildExistingReviewSession({ conversationId: 'conversation-1' })
    )
    const request = createMockRequest('POST', {
      message: 'Please update the summary',
      reviewSessionId: 'review-session-1',
      model: 'openai/gpt-5.6-terra',
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
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/copilot',
        body: expect.objectContaining({
          message: 'Please update the summary',
          userId: 'collaborator-user',
          model: 'openai/gpt-5.6-terra',
          conversationId: 'conversation-1',
          workspaceId: 'workspace-1',
          context: [],
          chatId: 'review-session-1',
          toolManifest: expect.objectContaining({
            version: 'v1',
            tools: expect.arrayContaining([
              expect.objectContaining({ name: 'read_workflow' }),
              expect.objectContaining({ name: 'edit_workflow' }),
            ]),
          }),
        }),
        signal: expect.any(AbortSignal),
      })
    )
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
    mockProxyCopilotRequest.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: '',
        toolCalls: [
          {
            id: 'tool-call-1',
            name: 'lookup_context',
            arguments: JSON.stringify({ query: 'price' }),
            success: true,
            result: { ok: true },
          },
        ],
      }),
    })

    const request = createMockRequest('POST', {
      message: 'Use the tool output only',
      reviewSessionId: 'review-session-1',
      model: 'openai/gpt-5.6-terra',
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
          contentBlocks: [
            expect.objectContaining({
              type: 'tool_call',
              toolCall: {
                id: 'tool-call-1',
                name: 'lookup_context',
                arguments: { query: 'price' },
                params: { query: 'price' },
                success: true,
                result: { ok: true },
              },
            }),
          ],
        }),
      })
    )
  })

  it('accepts live entity contexts and forwards processed supporting context to copilot', async () => {
    mockProcessContextsServer.mockResolvedValue([
      {
        type: 'current_monitor',
        content: '{"entityId":"monitor-1"}',
      },
    ])
    mockProxyCopilotRequest.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: 'Context-aware response',
      }),
    })

    const request = createMockRequest('POST', {
      message: 'Inspect the current monitor',
      reviewSessionId: 'review-session-1',
      stream: false,
      contexts: [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-1',
          workspaceId: 'workspace-1',
          label: 'Current Monitor',
        },
      ],
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    const contextSignal = mockProcessContextsServer.mock.calls[0]?.[4]?.signal
    expect(contextSignal).toBeInstanceOf(AbortSignal)
    expect(mockProcessContextsServer).toHaveBeenCalledWith(
      [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-1',
          workspaceId: 'workspace-1',
          label: 'Current Monitor',
        },
      ],
      'collaborator-user',
      'Inspect the current monitor',
      'workspace-1',
      { signal: contextSignal }
    )
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/copilot',
        body: expect.objectContaining({
          message: 'Inspect the current monitor',
          userId: 'collaborator-user',
          model: 'anthropic/claude-fable-5',
          chatId: 'review-session-1',
          toolManifest: expect.objectContaining({
            version: 'v1',
          }),
          context: [
            {
              type: 'current_monitor',
              content: '{"entityId":"monitor-1"}',
            },
          ],
        }),
        signal: contextSignal,
      })
    )
  })

  it('rejects a request workspace that differs from the existing chat workspace', async () => {
    const request = createMockRequest('POST', {
      message: 'Read this monitor',
      reviewSessionId: 'review-session-1',
      workspaceId: 'workspace-2',
      stream: false,
      contexts: [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-2',
          workspaceId: 'workspace-2',
          label: 'Current monitor',
        },
      ],
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'workspaceId does not match the review session workspace',
    })
    expect(mockProcessContextsServer).not.toHaveBeenCalled()
    expect(mockProxyCopilotRequest).not.toHaveBeenCalled()
  })

  it('does not create a new chat when context hydration is aborted', async () => {
    const controller = new AbortController()
    mockProcessContextsServer.mockImplementation(
      (...args: unknown[]) =>
        new Promise((_resolve, reject) => {
          const signal = (args[4] as { signal: AbortSignal }).signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const request = new NextRequest('http://localhost:3000/api/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Read the current monitor',
        model: 'anthropic/claude-fable-5',
        stream: false,
        workspaceId: 'workspace-1',
        contexts: [
          {
            kind: 'current_monitor',
            monitorId: 'monitor-1',
            workspaceId: 'workspace-1',
            label: 'Current monitor',
          },
        ],
      }),
      signal: controller.signal,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const pending = POST(request)
    await vi.waitFor(() => expect(mockProcessContextsServer).toHaveBeenCalled())
    expect(mockInsert).not.toHaveBeenCalled()

    controller.abort()
    const response = await pending

    expect(response.status).toBe(204)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockProxyCopilotRequest).not.toHaveBeenCalled()
  })

  it('rejects context arrays above the per-turn limit before creating a chat', async () => {
    const request = createMockRequest('POST', {
      message: 'Read these contexts',
      model: 'anthropic/claude-fable-5',
      stream: false,
      workspaceId: 'workspace-1',
      contexts: Array.from({ length: 17 }, (_, index) => ({
        kind: 'blocks',
        blockTypes: [`block-${index}`],
        label: `Block ${index}`,
      })),
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(mockProcessContextsServer).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('keeps entity labels in the saved message but sends ordered ids to the model', async () => {
    const contexts = [
      { kind: 'workflow', workflowId: 'workflow-1', label: 'Workflow' },
      { kind: 'skill', skillId: 'skill-1', label: 'Skill' },
      { kind: 'indicator', indicatorId: 'indicator-1', label: 'Indicator' },
      { kind: 'custom_tool', customToolId: 'tool-1', label: 'Tool' },
      { kind: 'mcp_server', mcpServerId: 'mcp-1', label: 'MCP' },
      { kind: 'watchlist', watchlistId: 'watchlist-1', label: 'Watchlist' },
      {
        kind: 'dashboard_layout',
        dashboardLayoutId: 'layout-1',
        ownerUserId: 'collaborator-user',
        workspaceId: 'workspace-1',
        label: 'Layout',
      },
    ]
    const message = '@Workflow @Skill @Indicator @Tool @MCP @Watchlist @Layout'
    const modelMessage = '@workflow-1 @skill-1 @indicator-1 @tool-1 @mcp-1 @watchlist-1 @layout-1'
    mockLoadReviewSessionForUser.mockResolvedValue(buildExistingReviewSession({ title: null }))
    mockProcessContextsServer.mockResolvedValue([
      { type: 'workflow', content: '{"entityId":"workflow-1"}' },
    ])

    const request = createMockRequest('POST', {
      message,
      reviewSessionId: 'review-session-1',
      workspaceId: 'workspace-1',
      stream: false,
      contexts,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockProcessContextsServer.mock.calls[0]?.[2]).toBe(message)
    expect(mockProxyCopilotRequest.mock.calls[0]?.[0].body.message).toBe(modelMessage)
    expect(mockRequestCopilotTitle).toHaveBeenCalledWith(
      expect.objectContaining({ message: modelMessage })
    )
    expect(mockBuildAppendReviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.objectContaining({ content: message, contexts }),
      })
    )
    expect(body.metadata.message).toBe(message)
  })

  it('preserves tool-call metadata for non-streaming text responses', async () => {
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
      model: 'openai/gpt-5.6-terra',
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
          contentBlocks: [
            expect.objectContaining({
              type: 'tool_call',
              toolCall: {
                id: 'tool-call-1',
                name: 'lookup_context',
                success: true,
                result: { ok: true },
              },
            }),
          ],
        }),
      })
    )
  })

  it('derives append sequences from the latest in-transaction session history', async () => {
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

  it('rewrites an already-persisted user turn with finalized assistant content', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue(
      buildExistingReviewSession({ conversationId: 'conversation-1' })
    )
    txSelectOrderBy.mockResolvedValueOnce([
      {
        itemId: 'user-message-duplicate',
        messageRole: 'user',
        content: 'Please update the summary',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ])

    const request = createMockRequest('POST', {
      message: 'Please update the summary',
      userMessageId: 'user-message-duplicate',
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
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockDeriveReviewTurnsAndItems).toHaveBeenCalledWith(
      'review-session-1',
      [
        {
          id: 'user-message-duplicate',
          role: 'user',
          content: 'Please update the summary',
          timestamp: expect.any(String),
          fileAttachments: undefined,
          contexts: undefined,
        },
        {
          id: expect.any(String),
          role: 'assistant',
          content: 'Saved response',
          timestamp: expect.any(String),
        },
      ],
      'completed'
    )
    expect(txDeleteWhere).toHaveBeenCalledTimes(2)
    expect(txInsertValues).toHaveBeenCalledTimes(2)
    expect(mockBuildAppendReviewTurn).not.toHaveBeenCalled()
    expect(txUpdateWhere).toHaveBeenCalledTimes(2)
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

  it('returns 404 when the supplied reviewSessionId is entity-bound', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue(
      buildExistingReviewSession({
        id: 'entity-review-session-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        title: 'Skill review',
      })
    )

    const request = createMockRequest('POST', {
      message: 'Please update the summary',
      reviewSessionId: 'entity-review-session-1',
      stream: false,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Review session not found or unauthorized',
    })
    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'entity-review-session-1',
      'collaborator-user'
    )
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockProxyCopilotRequest).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('creates a fresh generic copilot session in the workspace history bucket', async () => {
    mockInsertReturning.mockResolvedValueOnce([
      {
        id: 'review-session-channel-1',
        userId: 'collaborator-user',
        workspaceId: 'workspace-1',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: null,
        model: 'anthropic/claude-fable-5',
        conversationId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const request = createMockRequest('POST', {
      message: 'Start a fresh generic copilot chat',
      workspaceId: 'workspace-1',
      model: 'anthropic/claude-fable-5',
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
      })
    )
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/copilot',
        body: expect.objectContaining({
          message: 'Start a fresh generic copilot chat',
          userId: 'collaborator-user',
          model: 'anthropic/claude-fable-5',
          workspaceId: 'workspace-1',
          chatId: 'review-session-channel-1',
          toolManifest: expect.objectContaining({
            version: 'v1',
          }),
        }),
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('creates a new generic copilot session even when older chats exist in the same workspace', async () => {
    mockInsertReturning.mockResolvedValueOnce([
      {
        id: 'review-session-channel-newer',
        userId: 'collaborator-user',
        workspaceId: 'workspace-1',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: null,
        model: 'anthropic/claude-fable-5',
        conversationId: null,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ])

    const request = createMockRequest('POST', {
      message: 'Create another chat in the same workspace',
      workspaceId: 'workspace-1',
      model: 'anthropic/claude-fable-5',
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
      })
    )
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/copilot',
        body: expect.objectContaining({
          message: 'Create another chat in the same workspace',
          chatId: 'review-session-channel-newer',
        }),
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('persists the finalized assistant item text from a streamed reply', async () => {
    mockLoadReviewSessionForUser.mockResolvedValueOnce(
      buildPersistedReviewSession('review-session-finalized-stream', 'Finalized stream chat')
    )
    mockProxyCopilotRequest.mockResolvedValueOnce({
      ok: true,
      body: createSseStream([
        {
          type: 'response.output_item.added',
          item: {
            id: 'assistant-item-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'assistant-item-1',
          delta: 'Draft reply that should be replaced.',
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'assistant-item-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Final corrected reply.' }],
          },
        },
        { type: 'response.completed', response: { id: 'response-finalized' } },
      ]),
    })

    const request = createMockRequest('POST', {
      message: 'Persist the final text, not the draft',
      reviewSessionId: 'review-session-finalized-stream',
      model: 'anthropic/claude-fable-5',
      stream: true,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    const responseText = await response.text()
    expect(responseText).toContain('"type":"turn_state"')
    expect(responseText).toContain('"phase":"streaming"')
    expect(responseText).toContain('"phase":"completed"')

    expect(mockBuildAppendReviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewSessionId: 'review-session-finalized-stream',
        assistantMessage: expect.objectContaining({
          content: 'Final corrected reply.',
        }),
      })
    )
  })

  it('persists streamed reasoning content blocks from a streamed reply', async () => {
    mockLoadReviewSessionForUser.mockResolvedValueOnce(
      buildPersistedReviewSession('review-session-reasoning-stream', 'Reasoning stream chat')
    )
    mockProxyCopilotRequest.mockResolvedValueOnce({
      ok: true,
      body: createSseStream([
        {
          type: 'response.output_item.added',
          item: {
            id: 'reasoning-item-1',
            type: 'reasoning',
            content: [{ type: 'reasoning_text', text: '' }],
          },
        },
        {
          type: 'response.reasoning_text.delta',
          item_id: 'reasoning-item-1',
          delta: 'Inspecting the workflow before saving.',
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'reasoning-item-1',
            type: 'reasoning',
            content: [
              {
                type: 'reasoning_text',
                text: 'Inspecting the workflow before saving.',
              },
            ],
          },
        },
        {
          type: 'response.output_item.added',
          item: {
            id: 'assistant-item-reasoning-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'assistant-item-reasoning-1',
          delta: 'Done.',
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'assistant-item-reasoning-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        },
        { type: 'response.completed', response: { id: 'response-reasoning' } },
      ]),
    })

    const request = createMockRequest('POST', {
      message: 'Persist the reasoning blocks too',
      reviewSessionId: 'review-session-reasoning-stream',
      model: 'anthropic/claude-fable-5',
      stream: true,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    await response.text()

    const lastBuildAppendReviewTurnCall = mockBuildAppendReviewTurn.mock.calls.at(-1) as
      | [{ assistantMessage?: unknown }]
      | undefined
    const persistedAssistantMessage = lastBuildAppendReviewTurnCall?.[0]?.assistantMessage

    expect(persistedAssistantMessage).toMatchObject({
      content: 'Done.',
      contentBlocks: [
        {
          type: 'thinking',
          content: 'Inspecting the workflow before saving.',
          itemId: 'reasoning-item-1',
          timestamp: expect.any(Number),
          startTime: expect.any(Number),
          duration: expect.any(Number),
        },
        {
          type: 'text',
          content: 'Done.',
          itemId: 'assistant-item-reasoning-1',
          timestamp: expect.any(Number),
        },
      ],
    })
  })

  it('marks rewritten streamed error replies as error turns instead of completed turns', async () => {
    mockLoadReviewSessionForUser.mockResolvedValueOnce(
      buildPersistedReviewSession('review-session-error-stream', 'Error stream chat')
    )
    mockProxyCopilotRequest.mockResolvedValueOnce({
      ok: true,
      body: createSseStream([{ type: 'error', error: 'Model exploded.' }]),
    })

    const request = createMockRequest('POST', {
      message: 'Handle the stream failure',
      reviewSessionId: 'review-session-error-stream',
      model: 'anthropic/claude-fable-5',
      stream: true,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    const responseText = await response.text()
    expect(responseText).toContain('"type":"turn_state"')
    expect(responseText).toContain('"status":"error"')
    expect(responseText).toContain('"phase":"error"')

    expect(mockBuildAppendReviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewSessionId: 'review-session-error-stream',
        latestTurnStatus: 'error',
        assistantMessage: expect.objectContaining({
          content: '_Model exploded._',
        }),
      })
    )
  })

  it('normalizes JSON-string function call arguments before persisting streamed tool calls', async () => {
    mockLoadReviewSessionForUser.mockResolvedValueOnce(
      buildPersistedReviewSession(
        'review-session-stringified-tool-args',
        'Stringified tool args chat'
      )
    )
    mockProxyCopilotRequest.mockResolvedValueOnce({
      ok: true,
      body: createSseStream([
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'tool-call-stringified',
            name: 'read_workflow',
            arguments: JSON.stringify({ entityId: 'wf-stringified' }),
          },
        },
        { type: 'response.completed', response: { id: 'response-stringified-tool-args' } },
      ]),
    })

    const request = createMockRequest('POST', {
      message: 'Get the current workflow',
      reviewSessionId: 'review-session-stringified-tool-args',
      model: 'anthropic/claude-fable-5',
      stream: true,
    })

    const { POST } = await import('@/app/api/copilot/chat/route')
    const response = await POST(request)

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    await response.text()

    expect(mockBuildAppendReviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewSessionId: 'review-session-stringified-tool-args',
        assistantMessage: expect.objectContaining({
          contentBlocks: [
            expect.objectContaining({
              type: 'tool_call',
              toolCall: expect.objectContaining({
                id: 'tool-call-stringified',
                name: 'read_workflow',
                arguments: { entityId: 'wf-stringified' },
              }),
            }),
          ],
        }),
      })
    )
  })

  it('keeps a newly created workspace copilot chat when a streamed reply ends without assistant content', async () => {
    mockInsertReturning.mockResolvedValueOnce([
      {
        id: 'review-session-channel-empty',
        userId: 'collaborator-user',
        workspaceId: 'workspace-1',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: null,
        model: 'anthropic/claude-fable-5',
        conversationId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    mockProxyCopilotRequest.mockResolvedValueOnce({
      ok: true,
      body: createSseStream([{ type: 'response.completed', response: { id: 'response-empty-1' } }]),
    })

    const request = createMockRequest('POST', {
      message: 'Keep my user message even if the assistant is empty',
      workspaceId: 'workspace-1',
      model: 'anthropic/claude-fable-5',
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
    mockLoadReviewSessionForUser.mockResolvedValueOnce(
      buildPersistedReviewSession(
        'review-session-existing-scope',
        'Existing workspace copilot chat'
      )
    )
    mockProxyCopilotRequest.mockResolvedValueOnce({
      ok: true,
      body: createSseStream([{ type: 'response.completed', response: { id: 'response-empty-2' } }]),
    })

    const request = createMockRequest('POST', {
      message: 'Do not wipe existing history on an empty reply',
      reviewSessionId: 'review-session-existing-scope',
      model: 'anthropic/claude-fable-5',
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
