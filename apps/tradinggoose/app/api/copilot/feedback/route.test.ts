/**
 * @vitest-environment node
 */
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Copilot Feedback Shared Review Sessions', () => {
  const mockAuthenticate = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()
  const mockReturning = vi.fn()
  const mockValues = vi.fn(() => ({ returning: mockReturning }))
  const mockInsert = vi.fn(() => ({ values: mockValues }))

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()

    mockAuthenticate.mockResolvedValue({
      userId: 'collaborator-user',
      isAuthenticated: true,
    })

    mockReturning.mockResolvedValue([{ feedbackId: 'feedback-1' }])

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        insert: mockInsert,
        select: vi.fn(),
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      copilotFeedback: {
        feedbackId: 'copilot_feedback.feedback_id',
        userId: 'copilot_feedback.user_id',
        chatId: 'copilot_feedback.chat_id',
        userQuery: 'copilot_feedback.user_query',
        agentResponse: 'copilot_feedback.agent_response',
        isPositive: 'copilot_feedback.is_positive',
        feedback: 'copilot_feedback.feedback',
        workflowYaml: 'copilot_feedback.workflow_yaml',
        createdAt: 'copilot_feedback.created_at',
      },
    }))

    vi.doMock('@/lib/copilot/auth', () => ({
      authenticateCopilotRequestSessionOnly: mockAuthenticate,
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

    vi.doMock('@/lib/copilot/review-sessions/permissions', () => ({
      loadReviewSessionForUser: mockLoadReviewSessionForUser,
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

  it('allows a collaborator to submit feedback for a shared saved-entity review session', async () => {
    const reviewSessionId = '00000000-0000-0000-0000-000000000001'

    mockLoadReviewSessionForUser.mockResolvedValue({
      id: reviewSessionId,
      userId: 'creator-user',
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
    })

    const request = createMockRequest('POST', {
      reviewSessionId,
      userQuery: 'Can you simplify this tool description?',
      agentResponse: 'Yes, here is a shorter version.',
      isPositiveFeedback: true,
      feedback: 'This revision was accurate.',
    })

    const { POST } = await import('@/app/api/copilot/feedback/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      feedbackId: 'feedback-1',
      message: 'Feedback submitted successfully',
      metadata: {
        requestId: 'request-1',
        duration: 0,
      },
    })

    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      reviewSessionId,
      'collaborator-user'
    )
    expect(mockValues).toHaveBeenCalledWith({
      userId: 'collaborator-user',
      chatId: reviewSessionId,
      userQuery: 'Can you simplify this tool description?',
      agentResponse: 'Yes, here is a shorter version.',
      isPositive: true,
      feedback: 'This revision was accurate.',
      workflowYaml: null,
    })
  })

  it('returns not found when the caller cannot access the review session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue(null)

    const request = createMockRequest('POST', {
      reviewSessionId: '00000000-0000-0000-0000-000000000001',
      userQuery: 'Can you simplify this tool description?',
      agentResponse: 'Yes, here is a shorter version.',
      isPositiveFeedback: false,
    })

    const { POST } = await import('@/app/api/copilot/feedback/route')
    const response = await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Review session not found or unauthorized',
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
