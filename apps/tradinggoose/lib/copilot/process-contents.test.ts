/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const mockGetBlocksMetadataExecute = vi.fn()
const mockVerifyWorkflowAccess = vi.fn()
const mockVerifyReviewTargetAccess = vi.fn()
const mockReadBootstrappedReviewTargetSnapshot = vi.fn()
const mockReadWorkflowSnapshot = vi.fn()
const mockGetEntityFields = vi.fn()
const mockSanitizeForCopilot = vi.fn((value) => value)
const mockAnd = vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' }))
const mockEq = vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value }))
const mockOr = vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' }))
const mockLogRowsQueue: unknown[][] = []
const mockSelectChain: Record<string, any> = {}
mockSelectChain.from = vi.fn(() => mockSelectChain)
mockSelectChain.leftJoin = vi.fn(() => mockSelectChain)
mockSelectChain.innerJoin = vi.fn(() => mockSelectChain)
mockSelectChain.where = vi.fn(() => mockSelectChain)
mockSelectChain.limit = vi.fn(() => Promise.resolve(mockLogRowsQueue.shift() ?? []))
const mockDbSelect = vi.fn(() => mockSelectChain)

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  copilotReviewItems: {},
  copilotReviewSessions: {},
  document: {},
  knowledgeBase: {},
  permissions: {
    entityType: 'permissions.entityType',
    entityId: 'permissions.entityId',
    userId: 'permissions.userId',
  },
  templates: {},
  workflow: {
    id: 'workflow.id',
    name: 'workflow.name',
  },
  workflowExecutionLogs: {
    id: 'workflowExecutionLogs.id',
    workflowId: 'workflowExecutionLogs.workflowId',
    workspaceId: 'workflowExecutionLogs.workspaceId',
    executionId: 'workflowExecutionLogs.executionId',
    level: 'workflowExecutionLogs.level',
    trigger: 'workflowExecutionLogs.trigger',
    startedAt: 'workflowExecutionLogs.startedAt',
    endedAt: 'workflowExecutionLogs.endedAt',
    totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
    executionData: 'workflowExecutionLogs.executionData',
    cost: 'workflowExecutionLogs.cost',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
  },
  workspace: {
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  asc: vi.fn(),
  eq: mockEq,
  isNull: vi.fn(),
  or: mockOr,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: mockVerifyReviewTargetAccess,
  verifyWorkflowAccess: mockVerifyWorkflowAccess,
}))

vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata', () => ({
  getBlocksMetadataServerTool: {
    execute: mockGetBlocksMetadataExecute,
  },
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedReviewTargetSnapshot: mockReadBootstrappedReviewTargetSnapshot,
}))

vi.mock('@/lib/yjs/workflow-session', () => ({
  readWorkflowSnapshot: mockReadWorkflowSnapshot,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  getEntityFields: mockGetEntityFields,
}))

vi.mock('@/lib/workflows/json-sanitizer', () => ({
  sanitizeForCopilot: mockSanitizeForCopilot,
}))

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetBlocksMetadataExecute.mockReset()
    mockVerifyWorkflowAccess.mockReset()
    mockVerifyReviewTargetAccess.mockReset()
    mockReadBootstrappedReviewTargetSnapshot.mockReset()
    mockReadWorkflowSnapshot.mockReset()
    mockGetEntityFields.mockReset()
    mockSanitizeForCopilot.mockClear()
    mockAnd.mockClear()
    mockEq.mockClear()
    mockOr.mockClear()
    mockLogRowsQueue.length = 0
    mockDbSelect.mockClear()
    mockSelectChain.leftJoin.mockClear()
    mockSelectChain.innerJoin.mockClear()
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'read',
      workspaceId: 'workspace-1',
      isOwner: false,
    })
    mockVerifyWorkflowAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'read',
      workspaceId: 'workspace-1',
      isOwner: false,
    })
  })

  it('expands block contexts through the canonical blockTypes path', async () => {
    mockGetBlocksMetadataExecute.mockResolvedValue({
      metadata: {
        'block-1': {
          blockType: 'block-1',
          blockName: 'RSI',
          blockDescription: 'Relative Strength Index',
        },
      },
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [{ kind: 'blocks', blockTypes: ['block-1'], label: 'RSI' }],
      'user-1'
    )

    expect(mockGetBlocksMetadataExecute).toHaveBeenCalledWith({ blockTypes: ['block-1'] })
    expect(result).toEqual([
      {
        type: 'blocks',
        tag: '@RSI',
        content: JSON.stringify({
          metadata: {
            'block-1': {
              blockType: 'block-1',
              blockName: 'RSI',
              blockDescription: 'Relative Strength Index',
            },
          },
        }),
      },
    ])
  })

  it('skips block contexts without block types', async () => {
    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer([{ kind: 'blocks', label: 'Blocks' }], 'user-1')

    expect(mockGetBlocksMetadataExecute).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('hydrates current entity contexts from Yjs', async () => {
    const doc = new Y.Doc()
    const snapshotBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
    doc.destroy()
    mockReadBootstrappedReviewTargetSnapshot.mockResolvedValue({
      snapshotBase64,
      descriptor: {},
      runtime: { docState: 'active', replaySafe: false, reseededFromCanonical: false },
    })
    mockGetEntityFields.mockReturnValue({
      name: 'Canonical Skill',
      description: 'Canonical description',
      content: 'Canonical content',
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'current_skill',
          label: 'Current Skill',
          workspaceId: 'workspace-1',
          skillId: 'skill-1',
        },
      ],
      'user-1'
    )

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledWith(
      'user-1',
      {
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        reviewSessionId: null,
        workspaceId: 'workspace-1',
        yjsSessionId: 'skill-1',
      },
      'read'
    )
    expect(mockReadBootstrappedReviewTargetSnapshot).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: 'skill-1',
    })
    expect(mockGetEntityFields).toHaveBeenCalledWith(expect.any(Y.Doc), 'skill')
    expect(result).toEqual([
      {
        type: 'current_skill',
        tag: '@Current Skill',
        content: JSON.stringify(
          {
            id: 'skill-1',
            workspaceId: 'workspace-1',
            name: 'Canonical Skill',
            description: 'Canonical description',
            content: 'Canonical content',
          },
          null,
          2
        ),
      },
    ])
  })

  it('skips workspace entity contexts without read access', async () => {
    mockVerifyReviewTargetAccess.mockResolvedValueOnce({
      hasAccess: false,
      userPermission: null,
      workspaceId: null,
      isOwner: false,
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'current_skill',
          label: 'Current Skill',
          workspaceId: 'workspace-1',
          skillId: 'skill-1',
        },
      ],
      'user-1'
    )

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalled()
    expect(mockReadBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('hydrates workflow contexts from Yjs after verifying workflow read access', async () => {
    const doc = new Y.Doc()
    const snapshotBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
    doc.destroy()
    mockReadBootstrappedReviewTargetSnapshot.mockResolvedValue({
      snapshotBase64,
      descriptor: {},
      runtime: { docState: 'active', replaySafe: false, reseededFromCanonical: false },
    })
    mockReadWorkflowSnapshot.mockReturnValue({
      blocks: {
        trigger: {
          id: 'trigger',
          type: 'trigger',
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'workflow',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          label: 'Attached Workflow',
        },
      ],
      'user-1'
    )

    expect(mockVerifyWorkflowAccess).toHaveBeenCalledWith('user-1', 'workflow-1', 'read')
    expect(mockReadBootstrappedReviewTargetSnapshot).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      entityKind: 'workflow',
      entityId: 'workflow-1',
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: 'workflow-1',
    })
    expect(mockSanitizeForCopilot).toHaveBeenCalledWith({
      blocks: {
        trigger: {
          id: 'trigger',
          type: 'trigger',
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    expect(result).toEqual([
      {
        type: 'workflow',
        tag: '@Attached Workflow',
        content: JSON.stringify(
          {
            blocks: {
              trigger: {
                id: 'trigger',
                type: 'trigger',
              },
            },
            edges: [],
            loops: {},
            parallels: {},
          },
          null,
          2
        ),
      },
    ])
  })

  it.each([
    {
      context: {
        kind: 'workflow',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        label: 'Attached Workflow',
      } as const,
    },
    {
      context: {
        kind: 'workflow_block',
        workflowId: 'workflow-1',
        blockId: 'block-1',
        label: 'Attached Block',
      } as const,
    },
  ])('skips workflow-derived contexts without workflow read access', async ({ context }) => {
    mockVerifyWorkflowAccess.mockResolvedValueOnce({
      hasAccess: false,
      userPermission: null,
      workspaceId: null,
      isOwner: false,
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer([context], 'user-1')

    expect(mockVerifyWorkflowAccess).toHaveBeenCalledWith('user-1', 'workflow-1', 'read')
    expect(mockReadBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('hydrates deleted workflow log contexts from the durable workflow summary', async () => {
    mockLogRowsQueue.push([
      {
        id: 'log-1',
        workflowId: null,
        executionId: 'execution-1',
        level: 'info',
        trigger: 'manual',
        startedAt: new Date('2026-04-23T00:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        executionData: {},
        cost: null,
        workflowSummary: {
          id: 'deleted-workflow-1',
          name: 'Deleted workflow',
        },
        entityName: null,
      },
    ])

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [{ kind: 'logs', executionId: 'execution-1', label: 'Deleted Run' }],
      'user-1'
    )

    expect(mockSelectChain.innerJoin).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace.id',
        ownerId: 'workspace.ownerId',
      }),
      {
        field: 'workspace.id',
        type: 'eq',
        value: 'workflowExecutionLogs.workspaceId',
      }
    )
    expect(mockSelectChain.leftJoin).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'permissions.entityId',
        entityType: 'permissions.entityType',
        userId: 'permissions.userId',
      }),
      expect.objectContaining({ type: 'and' })
    )
    expect(mockEq).toHaveBeenCalledWith('permissions.entityType', 'workspace')
    expect(mockEq).toHaveBeenCalledWith('permissions.entityId', 'workflowExecutionLogs.workspaceId')
    expect(mockEq).toHaveBeenCalledWith('permissions.userId', 'user-1')
    expect(mockEq).toHaveBeenCalledWith('workspace.ownerId', 'user-1')
    expect(mockOr).toHaveBeenCalled()
    expect(result).toHaveLength(1)
    const content = JSON.parse(result[0]!.content)
    expect(content).toMatchObject({
      workflowId: 'deleted-workflow-1',
      entityName: 'Deleted workflow',
    })
  })
})
