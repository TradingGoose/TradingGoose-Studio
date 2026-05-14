/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const postAbort = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/copilot/chat/abort', {
    body: JSON.stringify(body),
    method: 'POST',
  })

describe('copilot chat abort route', () => {
  const mockAuthenticateCopilotRequestSessionOnly = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()
  const mockLoadReviewSessionForUserByConversationId = vi.fn()
  const mockProxyCopilotRequest = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockProxyCopilotRequest.mockResolvedValue(new Response(null, { status: 200 }))

    vi.doMock('@/lib/copilot/auth', () => ({
      authenticateCopilotRequestSessionOnly: (...args: unknown[]) =>
        mockAuthenticateCopilotRequestSessionOnly(...args),
      createBadRequestResponse: (message: string) =>
        Response.json({ error: message }, { status: 400 }),
      createInternalServerErrorResponse: (message: string) =>
        Response.json({ error: message }, { status: 500 }),
      createNotFoundResponse: (message: string) =>
        Response.json({ error: message }, { status: 404 }),
      createUnauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }))

    vi.doMock('@/lib/copilot/review-sessions/permissions', () => ({
      loadReviewSessionForUser: (...args: unknown[]) => mockLoadReviewSessionForUser(...args),
      loadReviewSessionForUserByConversationId: (...args: unknown[]) =>
        mockLoadReviewSessionForUserByConversationId(...args),
    }))

    vi.doMock('@/lib/copilot/session-scope', () => ({
      COPILOT_SESSION_KIND: 'copilot',
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        error: vi.fn(),
        warn: vi.fn(),
      })),
    }))

    vi.doMock('@/app/api/copilot/proxy', () => ({
      proxyCopilotRequest: (...args: unknown[]) => mockProxyCopilotRequest(...args),
    }))
  })

  it('proxies abort only after resolving an accessible chat session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      entityKind: 'copilot',
      conversationId: null,
      workspaceId: 'workspace-1',
    })
    const { POST } = await import('./route')

    const response = await POST(
      postAbort({
        chatId: 'review-session-1',
        conversationId: 'conversation-1',
        workspaceId: 'workspace-1',
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith('review-session-1', 'user-1', 'read')
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith({
      endpoint: '/api/tools/abort-turn',
      signal: expect.any(AbortSignal),
      body: {
        chatId: 'review-session-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    })
  })

  it('rejects abort when the supplied workspace does not match the chat session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      entityKind: 'copilot',
      conversationId: 'conversation-1',
      workspaceId: 'workspace-1',
    })
    const { POST } = await import('./route')

    const response = await POST(
      postAbort({
        chatId: 'review-session-1',
        conversationId: 'conversation-1',
        workspaceId: 'workspace-2',
      })
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Copilot chat not found or unauthorized' })
    expect(mockProxyCopilotRequest).not.toHaveBeenCalled()
  })

  it('resolves conversation-only abort requests through review-session access', async () => {
    mockLoadReviewSessionForUserByConversationId.mockResolvedValue({
      id: 'review-session-1',
      entityKind: 'copilot',
      conversationId: 'conversation-1',
      workspaceId: null,
    })
    const { POST } = await import('./route')

    const response = await POST(
      postAbort({
        conversationId: 'conversation-1',
        workspaceId: null,
      })
    )

    expect(response.status).toBe(200)
    expect(mockLoadReviewSessionForUser).not.toHaveBeenCalled()
    expect(mockLoadReviewSessionForUserByConversationId).toHaveBeenCalledWith(
      'conversation-1',
      'copilot',
      'user-1',
      'read'
    )
    expect(mockProxyCopilotRequest).toHaveBeenCalledWith({
      endpoint: '/api/tools/abort-turn',
      signal: expect.any(AbortSignal),
      body: {
        chatId: 'review-session-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        workspaceId: undefined,
      },
    })
  })
})
