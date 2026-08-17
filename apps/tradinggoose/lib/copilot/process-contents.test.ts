/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  MAX_COPILOT_CONTEXT_BYTES_PER_ITEM,
  MAX_COPILOT_CONTEXT_BYTES_PER_TURN,
} from '@/lib/copilot/context-limits'
import { buildCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import type { ChatContext } from '@/stores/copilot/types'

const WORKSPACE_CONTEXT_ENTITY_KINDS = [
  'workflow',
  'skill',
  'indicator',
  'custom_tool',
  'mcp_server',
  'watchlist',
  'dashboard_layout',
] as const
const WORKFLOW_BLOCK_CONTEXT = {
  kind: 'workflow_block',
  workflowId: 'workflow-1',
  blockId: 'block-1',
  label: 'Attached Block',
} satisfies ChatContext

const mockGetBlocksMetadataExecute = vi.fn()
const mockVerifyWorkflowAccess = vi.fn()
const mockReadBootstrappedReviewTargetSnapshot = vi.fn()
const mockReadWorkflowSnapshot = vi.fn()
const mockReadKnowledgeBaseExecute = vi.fn()
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
const buildLogContext = (
  kind: 'logs' | 'current_logs' = 'logs',
  workspaceId = 'workspace-1',
  label = kind === 'logs' ? 'Attached log' : 'Current log'
): ChatContext => ({ kind, logId: 'log-1', workspaceId, label })
const buildMonitorContext = (workspaceId = 'workspace-1'): ChatContext => ({
  kind: 'current_monitor',
  monitorId: 'monitor-1',
  workspaceId,
  label: 'Current monitor',
})
const buildKnowledgeContext = (workspaceId: string, current = false) =>
  buildCopilotWorkspaceEntityContext({
    entityKind: 'knowledge_base',
    entityId: 'knowledge-1',
    workspaceId,
    label: current ? 'Current knowledge base' : 'Research',
    current,
  })
const processContexts = async (
  contexts: ChatContext[],
  workspaceId?: string,
  options?: { signal?: AbortSignal }
) => {
  const { processContextsServer } = await import('@/lib/copilot/process-contents')
  return processContextsServer(contexts, 'user-1', undefined, workspaceId, options)
}
const processWorkspaceContext = (context: ChatContext) => processContexts([context], 'workspace-1')
const expectContextWithinItemLimit = (content: string) =>
  expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(MAX_COPILOT_CONTEXT_BYTES_PER_ITEM)
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

    const result = await processContexts([
      { kind: 'blocks', blockTypes: ['block-1'], label: 'RSI' },
    ])

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
    const result = await processContexts([{ kind: 'blocks', label: 'Blocks' }])

    expect(mockGetBlocksMetadataExecute).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it.each(WORKSPACE_CONTEXT_ENTITY_KINDS)(
    'emits attached and current %s contexts as entity references',
    async (entityKind) => {
      const entityId = `${entityKind}-1`
      const label = `Attached ${entityKind}`
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
      const result = await processContexts(contexts)

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

  it.each([
    ['knowledge', buildKnowledgeContext('workspace-1', true), 'knowledge-1'],
    ['log', buildLogContext('current_logs'), 'log-1'],
    ['monitor', buildMonitorContext(), 'monitor-1'],
  ])('emits the current %s as an ID-only reference', async (_source, context, entityId) => {
    const result = await processWorkspaceContext(context)

    expect(result).toEqual([
      {
        type: context.kind,
        tag: `@${entityId}`,
        content: JSON.stringify({ entityId }, null, 2),
      },
    ])
    expect(mockReadKnowledgeBaseExecute).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it.each<[string, ChatContext, string | undefined]>([
    ['knowledge from another workspace', buildKnowledgeContext('workspace-2'), 'workspace-1'],
    ['log from another workspace', buildLogContext('logs', 'workspace-2', 'Run'), 'workspace-1'],
    ['log without an active workspace', buildLogContext('logs', 'workspace-1', 'Run'), undefined],
    ['monitor from another workspace', buildMonitorContext('workspace-2'), 'workspace-1'],
    ['monitor without an active workspace', buildMonitorContext(), undefined],
  ])('rejects %s', async (_source, context, activeWorkspaceId) => {
    const result = await processContexts([context], activeWorkspaceId)

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

    const result = await processContexts([WORKFLOW_BLOCK_CONTEXT])

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

    const result = await processWorkspaceContext(WORKFLOW_BLOCK_CONTEXT)

    expect(mockVerifyWorkflowAccess).toHaveBeenCalledWith('user-1', 'workflow-1', 'read')
    expect(mockReadBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('deduplicates canonical context identities before hydration', async () => {
    mockGetBlocksMetadataExecute.mockResolvedValue({
      metadata: { request: { blockType: 'request' } },
    })

    const result = await processContexts([
      { kind: 'blocks', blockTypes: ['request'], label: 'Request' },
      { kind: 'blocks', blockTypes: ['request'], label: 'Duplicate request' },
    ])

    expect(mockGetBlocksMetadataExecute).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
  })

  it('enforces one aggregate byte budget across processed contexts', async () => {
    mockGetBlocksMetadataExecute.mockResolvedValue({
      metadata: { request: { description: 'x'.repeat(MAX_COPILOT_CONTEXT_BYTES_PER_TURN) } },
    })

    const result = await processContexts([
      { kind: 'blocks', blockTypes: ['request'], label: 'Request' },
    ])

    expect(mockGetBlocksMetadataExecute).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('redacts and structurally bounds explicitly attached log details', async () => {
    const privateKey =
      '-----BEGIN PRIVATE KEY-----\nMIIEraw-private-key-body\n-----END PRIVATE KEY-----'
    mockLogRowsQueue.push([
      buildLogRow({
        executionData: {
          errorMessage: `failed https://storage.test/blob?sv=2024-01-01&sig=raw-azure-signature&se=2099-01-01\npassphrase=raw-passphrase\nprivateKey=${privateKey}`,
          traceSpans: [
            {
              id: 'span-1',
              input: {
                authToken: 'raw-auth-token',
                passphrase: 'raw-passphrase',
                longText: 'x'.repeat(5_000),
                values: Array.from({ length: 40 }, (_, index) => index),
                deep: { a: { b: { c: { d: { e: { value: 'too deep' } } } } } },
              },
              output: { apiSecret: 'raw-output-secret' },
            },
          ],
          finalOutput: {
            header: { Key: 'X-API-Key', Value: 'raw-table-secret' },
            named: { name: 'idToken', value: 'raw-named-secret' },
            safe: { Key: 'Content-Type', Value: 'application/json' },
            artifact: privateKey,
            url: 'https://storage.test/blob?X-Amz-Signature=raw-amz-signature&safe=visible',
          },
        },
      }),
    ])

    const [result] = await processWorkspaceContext(buildLogContext())

    const content = JSON.parse(result!.content)
    const input = content.executionData.traceSpans[0].input
    expect(input.authToken).toBe('[redacted]')
    expect(input.passphrase).toBe('[redacted]')
    expect(input.longText).toContain('[truncated]')
    expect(input.values).toHaveLength(25)
    expect(input.deep.a).toBe('[truncated]')
    expect(content.executionData.traceSpans[0].output.apiSecret).toBe('[redacted]')
    expect(content.executionData.errorMessage).toContain('sig=[redacted]&se=2099-01-01')
    expect(content.executionData.errorMessage).toContain('passphrase=[redacted]')
    expect(content.executionData.finalOutput).toEqual({
      header: { Key: 'X-API-Key', Value: '[redacted]' },
      named: { name: 'idToken', value: '[redacted]' },
      safe: { Key: 'Content-Type', Value: 'application/json' },
      artifact: '[redacted]',
      url: 'https://storage.test/blob?X-Amz-Signature=[redacted]&safe=visible',
    })
    expect(content.contextTruncated).toBe(true)
    expectContextWithinItemLimit(result!.content)
    expect(result!.content).not.toMatch(
      /raw-(?:amz|auth|azure|named|output|passphrase|private|table)/
    )
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

    const [result] = await processWorkspaceContext(buildLogContext())

    expectContextWithinItemLimit(result!.content)
    expect(JSON.parse(result!.content)).toMatchObject({
      id: 'log-1',
      contextTruncated: true,
      executionDetailsOmitted: true,
    })
  })

  it('preserves a caller abort before processing current context IDs', async () => {
    const controller = new AbortController()
    controller.abort('Request was already cancelled')

    await expect(
      processContexts([buildMonitorContext()], 'workspace-1', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'Aborted' })
  })
})
