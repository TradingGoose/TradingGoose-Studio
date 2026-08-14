/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  MAX_COPILOT_CONTEXT_BYTES_PER_ITEM,
  MAX_COPILOT_CONTEXT_BYTES_PER_TURN,
} from '@/lib/copilot/context-limits'
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
const mockReadBootstrappedReviewTargetSnapshot = vi.fn()
const mockReadWorkflowSnapshot = vi.fn()
const mockReadKnowledgeBaseExecute = vi.fn()
const mockReadMonitorExecute = vi.fn()
const mockAnd = vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' }))
const mockEq = vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value }))
const mockOr = vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' }))
const mockLogRowsQueue: unknown[][] = []
const buildLogRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'log-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  level: 'info',
  trigger: 'manual',
  startedAt: new Date('2026-04-23T00:00:00.000Z'),
  endedAt: null,
  totalDurationMs: null,
  executionData: {},
  cost: null,
  workflowSummary: { id: 'workflow-1', name: 'Workflow' },
  entityName: 'Workflow',
  ...overrides,
})
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
  verifyWorkflowAccess: mockVerifyWorkflowAccess,
}))

vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata', () => ({
  getBlocksMetadataServerTool: {
    execute: mockGetBlocksMetadataExecute,
  },
}))

vi.mock('@/lib/copilot/tools/server/monitor/read-monitor', () => ({
  readMonitorServerTool: {
    execute: mockReadMonitorExecute,
  },
}))

vi.mock('@/lib/copilot/tools/server/knowledge/knowledge-base', () => ({
  readKnowledgeBaseServerTool: {
    execute: mockReadKnowledgeBaseExecute,
  },
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedReviewTargetSnapshot: mockReadBootstrappedReviewTargetSnapshot,
}))

vi.mock('@/lib/yjs/workflow-session', () => ({
  readWorkflowSnapshot: mockReadWorkflowSnapshot,
}))

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetBlocksMetadataExecute.mockReset()
    mockVerifyWorkflowAccess.mockReset()
    mockReadBootstrappedReviewTargetSnapshot.mockReset()
    mockReadWorkflowSnapshot.mockReset()
    mockReadKnowledgeBaseExecute.mockReset()
    mockReadMonitorExecute.mockReset()
    mockAnd.mockClear()
    mockEq.mockClear()
    mockOr.mockClear()
    mockLogRowsQueue.length = 0
    mockDbSelect.mockClear()
    mockSelectChain.leftJoin.mockClear()
    mockSelectChain.innerJoin.mockClear()
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

      const contexts = [false, true].map((current) =>
        buildCopilotWorkspaceEntityContext({
          entityKind,
          entityId,
          workspaceId: 'workspace-metadata',
          ...(entityKind === 'dashboard_layout' ? { ownerUserId: 'user-1' } : {}),
          label,
          current,
        })
      )
      const result = await processContextsServer(contexts, 'user-1')

      expect(result).toEqual([
        {
          type: contexts[0].kind,
          tag: `@${entityId}`,
          content: JSON.stringify({ entityId }, null, 2),
        },
      ])
      for (const context of result) {
        expect(Object.keys(JSON.parse(context.content))).toEqual(['entityId'])
      }

      expect(mockReadBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
    }
  )

  it('hydrates current knowledge through the canonical knowledge_base entity path', async () => {
    const knowledgeBase = {
      entityKind: 'knowledge_base',
      entityId: 'knowledge-1',
      entityName: 'Research',
      workspaceId: 'workspace-1',
      documentFormat: 'tg-knowledge-base-document-v1',
      entityDocument: '{"description":"Research notes"}',
      docCount: 1,
      tokenCount: 42,
    }
    mockReadKnowledgeBaseExecute.mockResolvedValue(knowledgeBase)

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        buildCopilotWorkspaceEntityContext({
          entityKind: 'knowledge_base',
          entityId: 'knowledge-1',
          workspaceId: 'workspace-1',
          label: 'Current knowledge base',
          current: true,
        }),
      ],
      'user-1',
      undefined,
      'workspace-1'
    )

    expect(mockReadKnowledgeBaseExecute).toHaveBeenCalledWith(
      { entityId: 'knowledge-1' },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result).toEqual([
      {
        type: 'current_knowledge_base',
        tag: '@knowledge-1',
        content: JSON.stringify(knowledgeBase, null, 2),
      },
    ])
  })

  it('rejects knowledge contexts from a different active workspace', async () => {
    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        buildCopilotWorkspaceEntityContext({
          entityKind: 'knowledge_base',
          entityId: 'knowledge-1',
          workspaceId: 'workspace-2',
          label: 'Research',
        }),
      ],
      'user-1',
      undefined,
      'workspace-1'
    )

    expect(result).toEqual([])
    expect(mockReadKnowledgeBaseExecute).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('reads workflow document content only for an attached workflow block', async () => {
    const doc = new Y.Doc()
    const snapshotBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
    doc.destroy()
    mockReadBootstrappedReviewTargetSnapshot.mockResolvedValue({
      snapshotBase64,
      descriptor: {},
      runtime: { docState: 'active' },
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

  it('skips workflow block contexts without workflow read access', async () => {
    mockVerifyWorkflowAccess.mockResolvedValueOnce({
      hasAccess: false,
      userPermission: null,
      workspaceId: null,
      isOwner: false,
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
      'user-1',
      undefined,
      'workspace-1'
    )

    expect(mockVerifyWorkflowAccess).toHaveBeenCalledWith('user-1', 'workflow-1', 'read')
    expect(mockReadBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('hydrates the open log by its canonical log id', async () => {
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
      [
        {
          kind: 'current_logs',
          logId: 'log-1',
          workspaceId: 'workspace-1',
          label: 'Deleted Run',
        },
      ],
      'user-1',
      undefined,
      'workspace-1'
    )

    expect(mockEq).toHaveBeenCalledWith('workflowExecutionLogs.id', 'log-1')
    expect(mockEq).toHaveBeenCalledWith('workflowExecutionLogs.workspaceId', 'workspace-1')

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
    expect(result[0]?.type).toBe('current_logs')
  })

  it('projects implicit current logs without raw execution inputs, outputs, or stack traces', async () => {
    mockLogRowsQueue.push([
      buildLogRow({
        executionData: {
          traceSpans: [
            {
              id: 'span-1',
              blockId: 'block-1',
              name: 'Request',
              type: 'api',
              status: 'error',
              duration: 12,
              input: { apiKey: 'raw-input-secret' },
              output: { customerPayload: 'raw-output-payload' },
              children: [
                {
                  id: 'span-2',
                  name: 'HTTP tool',
                  type: 'tool',
                  status: 'success',
                  input: { authorization: 'Bearer raw-child-secret' },
                },
              ],
            },
          ],
          errorDetails: {
            blockId: 'block-1',
            blockName: 'Request',
            error: 'Authorization: Bearer raw-error-secret',
            stackTrace: 'stack with raw-stack-payload',
          },
        },
      }),
    ])

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const [result] = await processContextsServer(
      [
        {
          kind: 'current_logs',
          logId: 'log-1',
          workspaceId: 'workspace-1',
          label: 'Current log',
        },
      ],
      'user-1',
      undefined,
      'workspace-1'
    )

    const content = JSON.parse(result!.content)
    expect(content.executionData.traceSummary).toMatchObject({
      includedSpanCount: 2,
      errorSpanCount: 1,
      spans: [
        { id: 'span-1', blockId: 'block-1', name: 'Request', status: 'error' },
        { id: 'span-2', name: 'HTTP tool', status: 'success' },
      ],
    })
    expect(content.executionData.errorSummary).toEqual({
      blockId: 'block-1',
      blockName: 'Request',
    })
    expect(result!.content).not.toContain('raw-input-secret')
    expect(result!.content).not.toContain('raw-output-payload')
    expect(result!.content).not.toContain('raw-child-secret')
    expect(result!.content).not.toContain('raw-stack-payload')
    expect(content.executionData).not.toHaveProperty('traceSpans')
    expect(content.executionData.errorSummary).not.toHaveProperty('message')
  })

  it('deduplicates canonical context identities before hydration', async () => {
    mockGetBlocksMetadataExecute.mockResolvedValue({
      metadata: { request: { blockType: 'request' } },
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        { kind: 'blocks', blockTypes: ['request'], label: 'Request' },
        { kind: 'blocks', blockTypes: ['request'], label: 'Duplicate request' },
      ],
      'user-1'
    )

    expect(mockGetBlocksMetadataExecute).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
  })

  it('enforces one aggregate byte budget across processed contexts', async () => {
    mockGetBlocksMetadataExecute.mockResolvedValue({
      metadata: { request: { description: 'x'.repeat(MAX_COPILOT_CONTEXT_BYTES_PER_TURN) } },
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [{ kind: 'blocks', blockTypes: ['request'], label: 'Request' }],
      'user-1'
    )

    expect(mockGetBlocksMetadataExecute).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(
      MAX_COPILOT_CONTEXT_BYTES_PER_TURN
    )
  })

  it('redacts and structurally bounds explicitly attached log details', async () => {
    mockLogRowsQueue.push([
      buildLogRow({
        executionData: {
          traceSpans: [
            {
              id: 'span-1',
              input: {
                authToken: 'raw-auth-token',
                idToken: 'raw-id-token',
                headers: { Authorization: 'Bearer raw-header-token' },
                note: 'request failed: token=raw-generic-token; idToken=raw-inline-id-token; password=[redacted]',
                serialized: '{"token":"raw-json-token","idToken":"raw-json-id","safe":"visible"}',
                longText: 'x'.repeat(5_000),
                values: Array.from({ length: 40 }, (_, index) => index),
                deep: { a: { b: { c: { d: { e: { value: 'too deep' } } } } } },
              },
              output: { apiSecret: 'raw-output-secret' },
            },
          ],
        },
      }),
    ])

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const [result] = await processContextsServer(
      [{ kind: 'logs', logId: 'log-1', workspaceId: 'workspace-1', label: 'Attached log' }],
      'user-1',
      undefined,
      'workspace-1'
    )

    const content = JSON.parse(result!.content)
    const input = content.executionData.traceSpans[0].input
    expect(input.authToken).toBe('[redacted]')
    expect(input.idToken).toBe('[redacted]')
    expect(input.headers.Authorization).toBe('[redacted]')
    expect(input.note).toBe(
      'request failed: token=[redacted]; idToken=[redacted]; password=[redacted]'
    )
    expect(input.serialized).toBe('{"token":[redacted],"idToken":[redacted],"safe":"visible"}')
    expect(input.longText).toContain('[truncated]')
    expect(input.values).toHaveLength(25)
    expect(input.deep.a).toBe('[truncated]')
    expect(content.executionData.traceSpans[0].output.apiSecret).toBe('[redacted]')
    expect(content.contextTruncated).toBe(true)
    expect(Buffer.byteLength(result!.content, 'utf8')).toBeLessThanOrEqual(16_384)
    expect(result!.content).not.toMatch(/raw-(?:auth|generic|id|header|inline|json|output)/)
  })

  it('falls back deterministically when bounded explicit details still exceed the byte cap', async () => {
    mockLogRowsQueue.push([
      buildLogRow({
        executionData: {
          traceSpans: Array.from({ length: 24 }, (_, index) => ({
            id: `span-${index}`,
            output: Object.fromEntries(
              Array.from({ length: 24 }, (__, field) => [`field-${field}`, 'x'.repeat(2_048)])
            ),
          })),
        },
      }),
    ])

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const [result] = await processContextsServer(
      [{ kind: 'logs', logId: 'log-1', workspaceId: 'workspace-1', label: 'Attached log' }],
      'user-1',
      undefined,
      'workspace-1'
    )

    expect(Buffer.byteLength(result!.content, 'utf8')).toBeLessThanOrEqual(16_384)
    expect(JSON.parse(result!.content)).toMatchObject({
      id: 'log-1',
      contextTruncated: true,
      executionDetailsOmitted: true,
    })
  })

  it('rejects log contexts from a different active workspace', async () => {
    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'logs',
          logId: 'log-1',
          workspaceId: 'workspace-2',
          label: 'Run',
        },
      ],
      'user-1',
      undefined,
      'workspace-1'
    )

    expect(result).toEqual([])
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('rejects log contexts without an active request workspace', async () => {
    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'logs',
          logId: 'log-1',
          workspaceId: 'workspace-1',
          label: 'Run',
        },
      ],
      'user-1'
    )

    expect(result).toEqual([])
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('reads the open monitor through the canonical monitor tool', async () => {
    const signal = new AbortController().signal
    mockReadMonitorExecute.mockResolvedValue({
      surfaceKind: 'monitor',
      monitorId: 'monitor-1',
      workspaceId: 'workspace-1',
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-1',
          workspaceId: 'workspace-1',
          label: 'Current monitor',
        },
      ],
      'user-1',
      undefined,
      'workspace-1',
      { signal }
    )

    expect(mockReadMonitorExecute).toHaveBeenCalledWith(
      { monitorId: 'monitor-1' },
      { userId: 'user-1', workspaceId: 'workspace-1', signal }
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'current_monitor',
      tag: '@Current monitor',
    })
    expect(JSON.parse(result[0]!.content)).toEqual({
      monitorId: 'monitor-1',
      surfaceKind: 'monitor',
      workspaceId: 'workspace-1',
    })
  })

  it('redacts sensitive identifiers from the implicit current monitor document', async () => {
    mockReadMonitorExecute.mockResolvedValue({
      surfaceKind: 'monitor',
      monitorId: 'monitor-1',
      monitorName: 'Portfolio state (account-private)',
      documentFormat: 'tg-monitor-document-v1',
      workspaceId: 'workspace-1',
      monitorDocument: JSON.stringify({
        source: 'portfolio',
        serviceId: 'service-private',
        credentialId: 'credential-private',
        accountId: 'account-private',
        condition: { root: { combinator: 'and', rules: [] } },
        providerParams: {
          apiKey: 'provider-secret',
          region: 'us-east-1',
        },
      }),
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const [result] = await processContextsServer(
      [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-1',
          workspaceId: 'workspace-1',
          label: 'Current monitor',
        },
      ],
      'user-1',
      undefined,
      'workspace-1'
    )

    const content = JSON.parse(result!.content)
    expect(content.monitorDocument).toMatchObject({
      serviceId: '[redacted]',
      credentialId: '[redacted]',
      accountId: '[redacted]',
      providerParams: {
        apiKey: '[redacted]',
        region: 'us-east-1',
      },
    })
    expect(result!.content).not.toMatch(
      /(?:service-private|credential-private|account-private|provider-secret)/
    )
  })

  it('bounds oversized implicit monitor provider parameters and conditions', async () => {
    mockReadMonitorExecute.mockResolvedValue({
      surfaceKind: 'monitor',
      monitorId: 'monitor-1',
      monitorName: 'Large monitor',
      documentFormat: 'tg-monitor-document-v1',
      workspaceId: 'workspace-1',
      monitorDocument: JSON.stringify({
        providerParams: Object.fromEntries(
          Array.from({ length: 64 }, (_, index) => [`parameter-${index}`, 'x'.repeat(4_096)])
        ),
        condition: {
          root: {
            combinator: 'or',
            rules: Array.from({ length: 64 }, (_, index) => ({
              id: `rule-${index}`,
              metric: 'value',
              value: 'y'.repeat(4_096),
            })),
          },
        },
      }),
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const [result] = await processContextsServer(
      [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-1',
          workspaceId: 'workspace-1',
          label: 'Current monitor',
        },
      ],
      'user-1',
      undefined,
      'workspace-1'
    )

    expect(Buffer.byteLength(result!.content, 'utf8')).toBeLessThanOrEqual(
      MAX_COPILOT_CONTEXT_BYTES_PER_ITEM
    )
    expect(JSON.parse(result!.content)).toMatchObject({
      contextTruncated: true,
      monitorDetailsOmitted: true,
      monitorId: 'monitor-1',
    })
  })

  it('preserves an in-flight monitor hydration abort instead of treating it as missing context', async () => {
    const controller = new AbortController()
    mockReadMonitorExecute.mockImplementation(
      (_args, context: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          })
        })
    )

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const processing = processContextsServer(
      [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-1',
          workspaceId: 'workspace-1',
          label: 'Current monitor',
        },
      ],
      'user-1',
      undefined,
      'workspace-1',
      { signal: controller.signal }
    )

    await vi.waitFor(() => expect(mockReadMonitorExecute).toHaveBeenCalled())
    expect(mockReadMonitorExecute.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    const rejection = expect(processing).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
  })

  it('does not start context hydration when the request is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { processContextsServer } = await import('@/lib/copilot/process-contents')

    await expect(
      processContextsServer(
        [
          {
            kind: 'current_monitor',
            monitorId: 'monitor-1',
            workspaceId: 'workspace-1',
            label: 'Current monitor',
          },
        ],
        'user-1',
        undefined,
        'workspace-1',
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockReadMonitorExecute).not.toHaveBeenCalled()
  })

  it('rejects monitor contexts from a different active workspace', async () => {
    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-1',
          workspaceId: 'workspace-2',
          label: 'Current monitor',
        },
      ],
      'user-1',
      undefined,
      'workspace-1'
    )

    expect(result).toEqual([])
    expect(mockReadMonitorExecute).not.toHaveBeenCalled()
  })

  it('rejects monitor contexts without an active request workspace', async () => {
    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-1',
          workspaceId: 'workspace-1',
          label: 'Current monitor',
        },
      ],
      'user-1'
    )

    expect(result).toEqual([])
    expect(mockReadMonitorExecute).not.toHaveBeenCalled()
  })
})
