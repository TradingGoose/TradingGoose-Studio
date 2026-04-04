/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockUpdate,
  mockLoadReviewSessionForUser,
  mockBuildReviewTargetDescriptor,
  mockGetDocument,
  mockSetPersistence,
  mockGetState,
  mockStoreState,
  mockEncodeStateAsUpdate,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockLoadReviewSessionForUser: vi.fn(),
  mockBuildReviewTargetDescriptor: vi.fn(),
  mockGetDocument: vi.fn(),
  mockSetPersistence: vi.fn(),
  mockGetState: vi.fn(),
  mockStoreState: vi.fn(),
  mockEncodeStateAsUpdate: vi.fn(),
}))

vi.mock('yjs', () => ({
  default: {},
  encodeStateAsUpdate: mockEncodeStateAsUpdate,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  copilotReviewSessions: {
    id: 'copilot_review_sessions.id',
    workspaceId: 'copilot_review_sessions.workspace_id',
    entityKind: 'copilot_review_sessions.entity_kind',
    entityId: 'copilot_review_sessions.entity_id',
    draftSessionId: 'copilot_review_sessions.draft_session_id',
    sessionScopeKey: 'copilot_review_sessions.session_scope_key',
    userId: 'copilot_review_sessions.user_id',
    model: 'copilot_review_sessions.model',
    updatedAt: 'copilot_review_sessions.updated_at',
  },
  customTools: {
    id: 'custom_tools.id',
    workspaceId: 'custom_tools.workspace_id',
    title: 'custom_tools.title',
  },
  mcpServers: {
    id: 'mcp_servers.id',
    workspaceId: 'mcp_servers.workspace_id',
    deletedAt: 'mcp_servers.deleted_at',
  },
  pineIndicators: {
    id: 'pine_indicators.id',
    workspaceId: 'pine_indicators.workspace_id',
  },
  skill: {
    id: 'skill.id',
    workspaceId: 'skill.workspace_id',
    name: 'skill.name',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  ne: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'ne' })),
}))

vi.mock('@/lib/colors', () => ({
  getStableVibrantColor: vi.fn(() => '#00a86b'),
}))

vi.mock('@/lib/copilot/review-sessions/identity', () => ({
  buildReviewTargetDescriptor: mockBuildReviewTargetDescriptor,
  buildSessionScopeKey: vi.fn(() => 'scope-key'),
}))

vi.mock('@/lib/copilot/review-sessions/entity-loaders', () => ({
  loadCustomTool: vi.fn(),
  loadIndicator: vi.fn(),
  loadMcpServer: vi.fn(),
  loadSkill: vi.fn(),
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  loadReviewSessionForUser: mockLoadReviewSessionForUser,
}))

vi.mock('@/lib/idempotency/service', () => ({
  IdempotencyService: class {
    async executeWithIdempotency(_scope: string, _key: string, fn: () => Promise<unknown>) {
      return fn()
    }
  },
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/mcp/url-validator', () => ({
  validateMcpServerUrl: vi.fn(() => ({
    isValid: true,
    normalizedUrl: 'https://example.com/mcp',
  })),
}))

vi.mock('@/lib/utils', () => ({
  normalizeStringArray: vi.fn((value: string[]) => value),
  sanitizeRecord: vi.fn((value: Record<string, string>) => value),
}))

vi.mock('@/lib/yjs/transaction-origins', () => ({
  YJS_ORIGINS: {
    SAVE: 'save',
  },
}))

vi.mock('@/socket-server/yjs/upstream-utils', () => ({
  getDocument: mockGetDocument,
  setPersistence: mockSetPersistence,
}))

vi.mock('@/socket-server/yjs/persistence', () => ({
  getState: mockGetState,
  storeState: mockStoreState,
}))

import {
  type SaveReviewEntityError,
  saveReviewEntity,
} from '@/lib/copilot/review-sessions/save-entity'

type MockChain = {
  then: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
}

function createMockChain(finalResult: unknown): MockChain {
  const chain: any = {}
  chain.then = vi
    .fn()
    .mockImplementation((resolve: (value: unknown) => unknown) => resolve(finalResult))
  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  return chain
}

describe('saveReviewEntity shared session access', () => {
  const reviewSessionId = '00000000-0000-0000-0000-000000000001'

  beforeEach(() => {
    vi.clearAllMocks()

    const metadataMap = {
      delete: vi.fn(),
    }
    const doc = {
      transact: vi.fn((callback: () => void) => callback()),
      getMap: vi.fn(() => metadataMap),
    }

    mockGetDocument.mockReturnValue(doc)
    mockEncodeStateAsUpdate.mockReturnValue(new Uint8Array())
    mockStoreState.mockResolvedValue(undefined)
    mockBuildReviewTargetDescriptor.mockImplementation((row: any) => ({
      workspaceId: row.workspaceId,
      entityKind: row.entityKind,
      entityId: row.entityId,
      draftSessionId: row.draftSessionId,
      reviewSessionId: row.id,
      reviewModel: row.model,
      yjsSessionId: row.id,
    }))
  })

  it('allows collaborators with write access to save a shared custom tool review session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: reviewSessionId,
      workspaceId: 'workspace-1',
      entityKind: 'custom_tool',
      entityId: 'tool-1',
      draftSessionId: null,
      sessionScopeKey: 'workspace=workspace-1|kind=custom_tool|target=entity:tool-1',
      userId: 'creator-user',
      model: 'claude-4.5-sonnet',
    })

    const savedTool = {
      id: 'tool-1',
      workspaceId: 'workspace-1',
      title: 'shared-tool',
      schema: {
        type: 'function',
        function: {
          name: 'shared-tool',
          description: 'Updated description',
          parameters: { type: 'object', properties: {} },
        },
      },
      code: 'export const sharedTool = true',
    }

    const updateReturning = vi.fn().mockResolvedValue([savedTool])
    const updateWhere = vi.fn(() => ({ returning: updateReturning }))
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    mockUpdate.mockReturnValue({ set: updateSet })

    mockSelect.mockReturnValue(
      createMockChain([
        {
          id: reviewSessionId,
          workspaceId: 'workspace-1',
          entityKind: 'custom_tool',
          entityId: 'tool-1',
          draftSessionId: null,
          model: 'claude-4.5-sonnet',
        },
      ])
    )

    const result = await saveReviewEntity('collaborator-user', {
      entityKind: 'custom_tool',
      workspaceId: 'workspace-1',
      reviewSessionId,
      customTool: {
        id: 'tool-1',
        schema: {
          type: 'function',
          function: {
            name: 'shared-tool',
            description: 'Updated description',
            parameters: { type: 'object', properties: {} },
          },
        },
        code: 'export const sharedTool = true',
      },
    })

    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      reviewSessionId,
      'collaborator-user',
      {
        requireWrite: true,
      }
    )
    expect(result).toEqual({
      success: true,
      data: [savedTool],
      reviewTarget: {
        workspaceId: 'workspace-1',
        entityKind: 'custom_tool',
        entityId: 'tool-1',
        draftSessionId: null,
        reviewSessionId,
        reviewModel: 'claude-4.5-sonnet',
        yjsSessionId: reviewSessionId,
      },
    })
  })

  it('keeps draft review sessions creator-owned', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue(null)

    const request = saveReviewEntity('collaborator-user', {
      entityKind: 'custom_tool',
      workspaceId: 'workspace-1',
      reviewSessionId,
      draftSessionId: 'draft-1',
      customTool: {
        schema: {
          type: 'function',
          function: {
            name: 'draft-tool',
            description: 'Draft tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        code: 'export const draftTool = true',
      },
    })

    await expect(request).rejects.toMatchObject<Partial<SaveReviewEntityError>>({
      status: 404,
      message: 'Review session not found',
    })
    expect(mockLoadReviewSessionForUser).toHaveBeenCalledWith(
      reviewSessionId,
      'collaborator-user',
      {
        requireWrite: true,
      }
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('preserves replay-safety checks after loading a shared review session', async () => {
    mockLoadReviewSessionForUser.mockResolvedValue({
      id: reviewSessionId,
      workspaceId: 'workspace-1',
      entityKind: 'custom_tool',
      entityId: 'tool-1',
      draftSessionId: null,
      sessionScopeKey: 'workspace=workspace-1|kind=custom_tool|target=entity:tool-1',
      userId: 'creator-user',
      model: 'claude-4.5-sonnet',
    })

    const request = saveReviewEntity('collaborator-user', {
      entityKind: 'custom_tool',
      workspaceId: 'workspace-2',
      reviewSessionId,
      customTool: {
        id: 'tool-1',
        schema: {
          type: 'function',
          function: {
            name: 'shared-tool',
            description: 'Updated description',
            parameters: { type: 'object', properties: {} },
          },
        },
        code: 'export const sharedTool = true',
      },
    })

    await expect(request).rejects.toMatchObject<Partial<SaveReviewEntityError>>({
      status: 409,
      message: 'replay_unsafe',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
