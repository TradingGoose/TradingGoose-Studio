/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetBlocksMetadataExecute = vi.fn()
const mockLoadSkill = vi.fn()
const mockLoadWorkflowStateWithFallback = vi.fn()
const mockSanitizeForCopilot = vi.fn((value) => value)
const mockAnd = vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' }))
const mockEq = vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value }))
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
}))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  asc: vi.fn(),
  eq: mockEq,
  isNull: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool', () => ({
  getBlocksMetadataServerTool: {
    execute: mockGetBlocksMetadataExecute,
  },
}))

vi.mock('@/lib/copilot/review-sessions/entity-loaders', () => ({
  loadSkill: mockLoadSkill,
  loadIndicator: vi.fn(),
  loadCustomTool: vi.fn(),
  loadMcpServer: vi.fn(),
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  loadWorkflowStateWithFallback: mockLoadWorkflowStateWithFallback,
}))

vi.mock('@/lib/workflows/json-sanitizer', () => ({
  sanitizeForCopilot: mockSanitizeForCopilot,
}))

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetBlocksMetadataExecute.mockReset()
    mockLoadSkill.mockReset()
    mockLoadWorkflowStateWithFallback.mockReset()
    mockSanitizeForCopilot.mockClear()
    mockAnd.mockClear()
    mockEq.mockClear()
    mockLogRowsQueue.length = 0
    mockDbSelect.mockClear()
    mockSelectChain.leftJoin.mockClear()
    mockSelectChain.innerJoin.mockClear()
  })

  it('expands block contexts through the canonical blockIds path', async () => {
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
      [{ kind: 'blocks', blockIds: ['block-1'], label: 'RSI' }],
      'user-1'
    )

    expect(mockGetBlocksMetadataExecute).toHaveBeenCalledWith({ blockIds: ['block-1'] })
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

  it('hydrates current entity contexts from the canonical entity loader', async () => {
    mockLoadSkill.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
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

    expect(mockLoadSkill).toHaveBeenCalledWith('skill-1', 'workspace-1')
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

  it('hydrates workflow contexts through the shared workspace entity path', async () => {
    mockLoadWorkflowStateWithFallback.mockResolvedValue({
      source: 'db',
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

    expect(mockLoadWorkflowStateWithFallback).toHaveBeenCalledWith('workflow-1')
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
        workflowName: null,
      },
    ])

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [{ kind: 'logs', executionId: 'execution-1', label: 'Deleted Run' } as any],
      'user-1'
    )

    expect(mockSelectChain.leftJoin).toHaveBeenCalled()
    expect(mockSelectChain.innerJoin).toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('permissions.entityType', 'workspace')
    expect(mockEq).toHaveBeenCalledWith('permissions.entityId', 'workflowExecutionLogs.workspaceId')
    expect(mockEq).toHaveBeenCalledWith('permissions.userId', 'user-1')
    expect(result).toHaveLength(1)
    const content = JSON.parse(result[0]!.content)
    expect(content).toMatchObject({
      workflowId: 'deleted-workflow-1',
      workflowName: 'Deleted workflow',
    })
  })
})
