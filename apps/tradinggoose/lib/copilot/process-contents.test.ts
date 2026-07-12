/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildCopilotWorkspaceEntityContext } from '@/widgets/widgets/copilot/workspace-entities'

const WORKSPACE_CONTEXT_ENTITY_KINDS = [
  'workflow',
  'skill',
  'indicator',
  'custom_tool',
  'mcp_server',
  'watchlist',
  'dashboard_layout',
] as const

const mockGetBlocksMetadataExecute = vi.fn()
const mockVerifyWorkflowAccess = vi.fn()
const mockVerifyReviewTargetAccess = vi.fn()
const mockReadBootstrappedReviewTargetSnapshot = vi.fn()
const mockReadBootstrappedSavedEntityFields = vi.fn()
const mockReadWorkflowSnapshot = vi.fn()
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
  readBootstrappedSavedEntityFields: mockReadBootstrappedSavedEntityFields,
}))

vi.mock('@/lib/yjs/workflow-session', () => ({
  readWorkflowSnapshot: mockReadWorkflowSnapshot,
}))

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetBlocksMetadataExecute.mockReset()
    mockVerifyWorkflowAccess.mockReset()
    mockVerifyReviewTargetAccess.mockReset()
    mockReadBootstrappedReviewTargetSnapshot.mockReset()
    mockReadBootstrappedSavedEntityFields.mockReset()
    mockReadWorkflowSnapshot.mockReset()
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

  it.each(WORKSPACE_CONTEXT_ENTITY_KINDS)(
    'emits attached and current %s contexts as entity references',
    async (entityKind) => {
      const entityId = `${entityKind}-1`
      const label = `Attached ${entityKind}`
      const { processContextsServer } = await import('@/lib/copilot/process-contents')

      for (const current of [false, true]) {
        const context = buildCopilotWorkspaceEntityContext({
          entityKind,
          entityId,
          workspaceId: 'workspace-1',
          ...(entityKind === 'dashboard_layout' ? { ownerUserId: 'user-1' } : {}),
          label,
          current,
        })
        const result = await processContextsServer([context], 'user-1')

        expect(result).toEqual([
          {
            type: context.kind,
            content: JSON.stringify({ entityId }, null, 2),
          },
        ])
        expect(Object.keys(JSON.parse(result[0]!.content))).toEqual(['entityId'])
        expect(result[0]).not.toHaveProperty('tag')
      }

      if (entityKind === 'workflow') {
        expect(mockVerifyWorkflowAccess).toHaveBeenCalledWith('user-1', entityId, 'read')
        expect(mockVerifyReviewTargetAccess).not.toHaveBeenCalled()
      } else {
        expect(mockVerifyReviewTargetAccess).toHaveBeenCalledWith(
          'user-1',
          {
            entityKind,
            entityId,
            draftSessionId: null,
            reviewSessionId: null,
            ownerUserId: entityKind === 'dashboard_layout' ? 'user-1' : null,
            workspaceId: 'workspace-1',
            yjsSessionId: entityId,
          },
          'read'
        )
      }
      expect(mockReadBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
      expect(mockReadBootstrappedSavedEntityFields).not.toHaveBeenCalled()
    }
  )

  it('skips dashboard layout contexts outside the authenticated owner scope', async () => {
    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'dashboard_layout',
          label: 'Other Layout',
          workspaceId: 'workspace-1',
          ownerUserId: 'user-2',
          dashboardLayoutId: 'layout-1',
        },
      ],
      'user-1'
    )

    expect(result).toEqual([])
    expect(mockVerifyReviewTargetAccess).not.toHaveBeenCalled()
    expect(mockReadBootstrappedSavedEntityFields).not.toHaveBeenCalled()
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
    expect(mockReadBootstrappedSavedEntityFields).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('reads workflow document content only for an attached workflow block', async () => {
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
        'block-1': { id: 'block-1', type: 'function', name: 'Inspect' },
      },
      edges: [],
      loops: {},
      parallels: {},
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'workflow_block',
          workflowId: 'workflow-1',
          blockId: 'block-1',
          label: 'Attached Block',
        },
      ],
      'user-1'
    )

    expect(mockVerifyWorkflowAccess).toHaveBeenCalledWith('user-1', 'workflow-1', 'read')
    expect(mockReadBootstrappedReviewTargetSnapshot).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      {
        type: 'workflow_block',
        tag: '@Attached Block in Workflow',
        content: JSON.stringify({
          workflowId: 'workflow-1',
          block: { id: 'block-1', type: 'function', name: 'Inspect' },
        }),
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
