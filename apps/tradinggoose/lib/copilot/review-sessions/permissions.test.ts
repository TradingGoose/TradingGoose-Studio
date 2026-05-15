/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  copilotReviewSessions: {
    id: 'copilot_review_sessions.id',
    workspaceId: 'copilot_review_sessions.workspace_id',
    entityKind: 'copilot_review_sessions.entity_kind',
    entityId: 'copilot_review_sessions.entity_id',
    draftSessionId: 'copilot_review_sessions.draft_session_id',
    userId: 'copilot_review_sessions.user_id',
    conversationId: 'copilot_review_sessions.conversation_id',
  },
  permissions: {
    permissionType: 'permissions.permission_type',
    userId: 'permissions.user_id',
    entityType: 'permissions.entity_type',
    entityId: 'permissions.entity_id',
  },
  workflow: {
    id: 'workflow.id',
    workspaceId: 'workflow.workspace_id',
    userId: 'workflow.user_id',
  },
  workspace: {
    id: 'workspace.id',
    ownerId: 'workspace.owner_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/workflows/utils', () => ({
  readWorkflowAccessContext: vi.fn(),
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  resolveEntityWorkspaceId: vi.fn(),
}))

import { db } from '@tradinggoose/db'
import {
  loadReviewSessionForUser,
  loadReviewSessionForUserByConversationId,
  verifyReviewTargetAccess,
} from '@/lib/copilot/review-sessions/permissions'
import { resolveEntityWorkspaceId } from '@/lib/yjs/server/entity-loaders'

type MockChain = {
  then: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  leftJoin: ReturnType<typeof vi.fn>
}

const mockDb = db as unknown as { select: ReturnType<typeof vi.fn> }
const mockResolveEntityWorkspaceId = vi.mocked(resolveEntityWorkspaceId)

function createMockChain(finalResult: any): MockChain {
  const chain: any = {}

  chain.then = vi.fn().mockImplementation((resolve: (value: any) => any) => resolve(finalResult))
  chain.select = vi.fn().mockReturnValue(chain)
  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.leftJoin = vi.fn().mockReturnValue(chain)

  return chain
}

describe('review session permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('derives saved entity workspace from the canonical entity', async () => {
    mockResolveEntityWorkspaceId.mockResolvedValueOnce('workspace-1')
    mockDb.select.mockReturnValueOnce(
      createMockChain([{ ownerId: 'owner-1', permissionType: 'read' }])
    )

    const result = await verifyReviewTargetAccess(
      'collaborator-1',
      {
        entityKind: 'skill',
        entityId: 'skill-1',
        workspaceId: 'workspace-1',
      },
      'read'
    )

    expect(mockResolveEntityWorkspaceId).toHaveBeenCalledWith('skill', 'skill-1')
    expect(result).toEqual({
      hasAccess: true,
      userPermission: 'read',
      workspaceId: 'workspace-1',
      isOwner: false,
    })
  })

  it('rejects saved entity targets when the supplied workspace does not match the entity', async () => {
    mockResolveEntityWorkspaceId.mockResolvedValueOnce('workspace-actual')

    const result = await verifyReviewTargetAccess(
      'collaborator-1',
      {
        entityKind: 'skill',
        entityId: 'skill-1',
        workspaceId: 'workspace-supplied',
      },
      'read'
    )

    expect(mockDb.select).not.toHaveBeenCalled()
    expect(result).toEqual({
      hasAccess: false,
      userPermission: null,
      workspaceId: null,
      isOwner: false,
    })
  })

  it('rejects review-session targets that carry entity ids', async () => {
    const reviewSessionRow = [
      {
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        userId: 'creator-1',
      },
    ]

    mockDb.select.mockReturnValueOnce(createMockChain(reviewSessionRow))

    const result = await verifyReviewTargetAccess(
      'creator-1',
      {
        entityKind: 'skill',
        entityId: 'skill-1',
        reviewSessionId: 'review-session-1',
        workspaceId: 'workspace-1',
      },
      'read'
    )

    expect(result).toEqual({
      hasAccess: false,
      userPermission: null,
      workspaceId: 'workspace-1',
      isOwner: false,
    })
  })

  it('keeps draft review sessions user-owned', async () => {
    const reviewSessionRow = [
      {
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: null,
        draftSessionId: 'draft-1',
        userId: 'creator-1',
      },
    ]

    mockDb.select.mockReturnValueOnce(createMockChain(reviewSessionRow))

    const result = await verifyReviewTargetAccess(
      'collaborator-1',
      {
        entityKind: 'skill',
        entityId: null,
        draftSessionId: 'draft-1',
        reviewSessionId: 'review-session-1',
        workspaceId: 'workspace-1',
      },
      'read'
    )

    expect(result).toEqual({
      hasAccess: false,
      userPermission: null,
      workspaceId: 'workspace-1',
      isOwner: false,
    })
  })

  it('keeps review sessions creator-owned when loading by reviewSessionId', async () => {
    const reviewSessionRow = [
      {
        id: 'review-session-1',
        workspaceId: 'workspace-1',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        userId: 'creator-1',
        model: 'claude-4.5-sonnet',
      },
    ]

    mockDb.select.mockReturnValueOnce(createMockChain(reviewSessionRow))

    const result = await loadReviewSessionForUser('review-session-1', 'collaborator-1')

    expect(result).toBeNull()
  })

  it('loads an accessible review session by conversation id', async () => {
    const reviewSessionRow = [
      {
        id: 'review-session-1',
        workspaceId: 'workspace-1',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        userId: 'user-1',
        model: 'claude-4.5-sonnet',
        conversationId: 'conversation-1',
      },
    ]

    mockDb.select.mockReturnValueOnce(createMockChain(reviewSessionRow))

    const result = await loadReviewSessionForUserByConversationId(
      'conversation-1',
      'copilot',
      'user-1'
    )

    expect(result).toEqual(reviewSessionRow[0])
  })

  it('keeps workflow review sessions creator-owned when loading by reviewSessionId', async () => {
    const reviewSessionRow = [
      {
        id: 'review-session-1',
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: 'workflow-1',
        draftSessionId: null,
        userId: 'creator-1',
        model: 'claude-4.5-sonnet',
      },
    ]

    mockDb.select.mockReturnValueOnce(createMockChain(reviewSessionRow))

    const result = await loadReviewSessionForUser('review-session-1', 'collaborator-1')

    expect(result).toBeNull()
  })
})
