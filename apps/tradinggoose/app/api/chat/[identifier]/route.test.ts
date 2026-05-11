/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  addCorsHeadersMock,
  validateChatAuthMock,
  setChatAuthCookieMock,
  getApiKeyOwnerUserIdMock,
  enqueuePendingExecutionMock,
  readWorkflowExecutionEventStateMock,
  eqMock,
  chatRows,
  workflowRows,
} = vi.hoisted(() => ({
  addCorsHeadersMock: vi.fn((response) => response),
  validateChatAuthMock: vi.fn(),
  setChatAuthCookieMock: vi.fn(),
  getApiKeyOwnerUserIdMock: vi.fn(),
  enqueuePendingExecutionMock: vi.fn(),
  readWorkflowExecutionEventStateMock: vi.fn(),
  eqMock: vi.fn((field, value) => ({ field, value })),
  chatRows: [] as any[],
  workflowRows: [] as any[],
}))

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  chat: {
    id: 'chat.id',
    identifier: 'chat.identifier',
    workflowId: 'chat.workflowId',
    userId: 'chat.userId',
    isActive: 'chat.isActive',
    authType: 'chat.authType',
    password: 'chat.password',
    allowedEmails: 'chat.allowedEmails',
    outputConfigs: 'chat.outputConfigs',
    title: 'chat.title',
    description: 'chat.description',
    customizations: 'chat.customizations',
  },
  workflow: {
    id: 'workflow.id',
    isDeployed: 'workflow.isDeployed',
    workspaceId: 'workflow.workspaceId',
    variables: 'workflow.variables',
    pinnedApiKeyId: 'workflow.pinnedApiKeyId',
  },
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn((fields) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => {
            if (fields?.isDeployed === 'workflow.isDeployed') {
              return workflowRows
            }
            return chatRows
          }),
        })),
      })),
    })),
  },
}))

vi.mock('@/app/api/chat/utils', () => ({
  addCorsHeaders: addCorsHeadersMock,
  validateChatAuth: validateChatAuthMock,
  setChatAuthCookie: setChatAuthCookieMock,
  validateAuthToken: vi.fn(() => true),
}))

vi.mock('@/lib/api-key/service', () => ({
  getApiKeyOwnerUserId: getApiKeyOwnerUserIdMock,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: enqueuePendingExecutionMock,
  isPendingExecutionLimitError: vi.fn(() => false),
}))

vi.mock('@/lib/execution/workflow-execution-events', () => ({
  readWorkflowExecutionEventState: readWorkflowExecutionEventStateMock,
}))

vi.mock('@/lib/uploads', () => ({
  ChatFiles: {
    processChatFiles: vi.fn(() => Promise.resolve([])),
  },
}))

vi.mock('@/lib/trigger/settings', () => ({
  TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {
    statusCode = 409
  },
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
  encodeSSE: (value: unknown) =>
    new TextEncoder().encode(
      `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`
    ),
  SSE_HEADERS: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  },
}))

describe('/api/chat/[identifier]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatRows.length = 0
    workflowRows.length = 0

    chatRows.push({
      id: 'chat-1',
      workflowId: 'workflow-1',
      userId: 'owner-1',
      isActive: true,
      authType: 'public',
      title: 'Market Chat',
      description: 'Chat description',
      customizations: { welcomeMessage: 'Welcome' },
      outputConfigs: [
        { blockId: 'agent-1', path: 'content' },
        { blockId: 'agent-1', path: 'summary' },
      ],
    })
    workflowRows.push({
      isDeployed: true,
      workspaceId: 'workspace-1',
      variables: {},
      pinnedApiKeyId: 'api-key-1',
    })
    readWorkflowExecutionEventStateMock.mockResolvedValue({
      status: 'completed',
      result: null,
      errorMessage: null,
      events: [
        {
          eventId: 1,
          event: {
            type: 'stream:chunk',
            executionId: 'chat-execution-1',
            workflowId: 'workflow-1',
            timestamp: new Date().toISOString(),
            eventId: 1,
            data: {
              blockId: 'agent-1',
              chunk: 'streamed content',
            },
          },
        },
        {
          eventId: 2,
          event: {
            type: 'block:completed',
            executionId: 'chat-execution-1',
            workflowId: 'workflow-1',
            timestamp: new Date().toISOString(),
            eventId: 2,
            data: {
              blockId: 'agent-1',
              output: {
                content: 'streamed content',
                summary: 'completed summary',
              },
            },
          },
        },
        {
          eventId: 3,
          event: {
            type: 'execution:completed',
            executionId: 'chat-execution-1',
            workflowId: 'workflow-1',
            timestamp: new Date().toISOString(),
            eventId: 3,
            data: {
              result: {
                success: true,
                output: {},
                logs: [],
              },
            },
          },
        },
      ],
    })

    validateChatAuthMock.mockResolvedValue({ authorized: true })
    getApiKeyOwnerUserIdMock.mockResolvedValue('billing-user-1')
    enqueuePendingExecutionMock.mockResolvedValue({
      pendingExecutionId: 'chat-execution-1',
      billingScopeId: 'workspace-1',
    })
  })

  it('returns chat metadata for a valid identifier', async () => {
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('https://example.com/api/chat/test-chat'), {
      params: Promise.resolve({ identifier: 'test-chat' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: 'chat-1',
      title: 'Market Chat',
      description: 'Chat description',
    })
  })

  it('queues chat workflow messages and returns an SSE response from queued result', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/chat/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Hello',
          conversationId: 'conversation-1',
        }),
      }),
      { params: Promise.resolve({ identifier: 'test-chat' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(enqueuePendingExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionType: 'workflow',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'billing-user-1',
        source: 'published_chat',
        payload: expect.objectContaining({
          workflowId: 'workflow-1',
          userId: 'billing-user-1',
          workspaceId: 'workspace-1',
          input: {
            input: 'Hello',
            conversationId: 'conversation-1',
          },
          triggerType: 'chat',
          executionTarget: 'deployed',
        }),
      })
    )

    const body = await response.text()

    expect(body).toContain('streamed content')
    expect(body).toContain('completed summary')
  })

  it('requires a pinned API key owner for queued chat execution attribution', async () => {
    getApiKeyOwnerUserIdMock.mockResolvedValueOnce(null)

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/chat/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'Hello' }),
      }),
      { params: Promise.resolve({ identifier: 'test-chat' }) }
    )

    expect(response.status).toBe(503)
    expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
  })
})
