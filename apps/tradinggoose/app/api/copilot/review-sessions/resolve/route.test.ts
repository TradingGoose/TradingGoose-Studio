/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Review Session Resolve Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockInsert = vi.fn()
  const mockInsertValues = vi.fn()
  const mockInsertReturning = vi.fn()
  const mockUpdate = vi.fn()
  const mockUpdateSet = vi.fn()
  const mockUpdateWhere = vi.fn()
  const mockGetSession = vi.fn()
  const mockVerifyReviewTargetAccess = vi.fn()
  const mockLoadReviewSessionForUser = vi.fn()
  const mockBuildReviewTargetDescriptor = vi.fn()
  const mockBootstrapReviewTarget = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()

    mockGetSession.mockResolvedValue({ user: { id: 'collaborator-user' } })
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'read',
      workspaceId: 'workspace-1',
      isOwner: false,
    })
    mockBuildReviewTargetDescriptor.mockImplementation((row: any) => ({
      workspaceId: row.workspaceId,
      entityKind: row.entityKind,
      entityId: row.entityId,
      draftSessionId: row.draftSessionId,
      reviewSessionId: row.id,
      yjsSessionId: row.id,
    }))
    mockBootstrapReviewTarget.mockImplementation(async (descriptor: any) => ({
      descriptor,
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: false,
      },
    }))

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockLimit.mockResolvedValue([])
    mockInsertReturning.mockResolvedValue([])
    mockInsertValues.mockReturnValue({ returning: mockInsertReturning })
    mockInsert.mockReturnValue({ values: mockInsertValues })
    mockUpdateWhere.mockResolvedValue(undefined)
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockUpdate.mockReturnValue({ set: mockUpdateSet })

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      copilotReviewSessions: {
        id: 'copilot_review_sessions.id',
        userId: 'copilot_review_sessions.user_id',
        workspaceId: 'copilot_review_sessions.workspace_id',
        entityKind: 'copilot_review_sessions.entity_kind',
        entityId: 'copilot_review_sessions.entity_id',
        draftSessionId: 'copilot_review_sessions.draft_session_id',
        channelId: 'copilot_review_sessions.channel_id',
        model: 'copilot_review_sessions.model',
        updatedAt: 'copilot_review_sessions.updated_at',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
      eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
      isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: mockGetSession,
    }))

    vi.doMock('@/lib/copilot/review-sessions/identity', () => ({
      buildReviewTargetDescriptor: mockBuildReviewTargetDescriptor,
    }))

    vi.doMock('@/lib/copilot/review-sessions/permissions', () => ({
      loadReviewSessionForUser: mockLoadReviewSessionForUser,
      verifyReviewTargetAccess: mockVerifyReviewTargetAccess,
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      })),
    }))

    class MockReviewTargetBootstrapError extends Error {
      status: number

      constructor(status: number, message: string) {
        super(message)
        this.status = status
      }
    }

    vi.doMock('@/lib/yjs/server/bootstrap-review-target', () => ({
      bootstrapReviewTarget: mockBootstrapReviewTarget,
      ReviewTargetBootstrapError: MockReviewTargetBootstrapError,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('reuses an accessible shared saved-entity session by reviewSessionId for collaborators', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      draftSessionId: null,
      model: 'claude-4.5-sonnet',
    })

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      reviewSessionId: 'review-session-1',
    })

    const { POST } = await import('@/app/api/copilot/review-sessions/resolve/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      descriptor: {
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        reviewSessionId: 'review-session-1',
        yjsSessionId: 'review-session-1',
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: false,
      },
    })

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledWith('collaborator-user', {
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
    })
    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'review-session-1',
      'collaborator-user'
    )
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('reuses an existing shared saved-entity session by explicit entity fields', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'review-session-entity-1',
        userId: 'creator-user',
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        channelId: null,
        model: 'claude-4.5-sonnet',
      },
    ])

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
    })

    const { POST } = await import('@/app/api/copilot/review-sessions/resolve/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      descriptor: {
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        reviewSessionId: 'review-session-entity-1',
        yjsSessionId: 'review-session-entity-1',
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: false,
      },
    })
    expect(mockLoadReviewSessionForUser).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('reuses an existing draft session only for the current user', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'review-session-draft-1',
        userId: 'collaborator-user',
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: null,
        draftSessionId: 'draft-1',
        channelId: null,
        model: 'claude-4.5-sonnet',
      },
    ])

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      draftSessionId: 'draft-1',
    })

    const { POST } = await import('@/app/api/copilot/review-sessions/resolve/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      descriptor: {
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: null,
        draftSessionId: 'draft-1',
        reviewSessionId: 'review-session-draft-1',
        yjsSessionId: 'review-session-draft-1',
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: false,
      },
    })
    expect(mockLoadReviewSessionForUser).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('does not reuse a reviewSessionId when the helper denies access to that session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue(null)

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      reviewSessionId: 'review-session-1',
      draftSessionId: 'draft-1',
    })

    const { POST } = await import('@/app/api/copilot/review-sessions/resolve/route')
    const response = await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Review session not found',
    })
    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      'review-session-1',
      'collaborator-user'
    )
    expect(mockBootstrapReviewTarget).not.toHaveBeenCalled()
  })

  it('keeps the existing target mismatch check when the loaded session is for another target', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      workspaceId: 'workspace-2',
      entityKind: 'custom_tool',
      entityId: 'tool-1',
      draftSessionId: null,
      model: 'claude-4.5-sonnet',
    })

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      reviewSessionId: 'review-session-1',
    })

    const { POST } = await import('@/app/api/copilot/review-sessions/resolve/route')
    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Review session does not match requested target',
    })
    expect(mockBootstrapReviewTarget).not.toHaveBeenCalled()
  })

  it('rejects a cached reviewSessionId when it belongs to a different entity in the same workspace', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: 'review-session-1',
      userId: 'creator-user',
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-2',
      draftSessionId: null,
      model: 'claude-4.5-sonnet',
    })

    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      reviewSessionId: 'review-session-1',
    })

    const { POST } = await import('@/app/api/copilot/review-sessions/resolve/route')
    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Review session does not match requested target',
    })
    expect(mockBootstrapReviewTarget).not.toHaveBeenCalled()
  })
})
