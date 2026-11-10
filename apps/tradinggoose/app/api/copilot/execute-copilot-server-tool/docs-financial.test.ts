/** @vitest-environment node */
// Actual route/target/router/docs/embedding implementation; only unrelated tools and
// session/native-service/vector/provider/financial persistence seams are controlled here.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KNOWLEDGE_BASE_DOCUMENT_FORMAT,
  WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import {
  TG_MERMAID_DOCUMENT_FORMAT,
  WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/document-format'
import { DASHBOARD_LAYOUT_DOCUMENT_FORMAT } from '@/widgets/layout-document'

const editWorkflowExecute = vi.fn(async () => ({
  entityKind: 'workflow',
  entityId: 'workflow-123',
  entityName: 'Workflow 1',
  entityDocument: 'flowchart TD\n  n1["Input<br/>id: input1<br/>type: input_trigger"]',
  documentFormat: WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
  workflowState: { blocks: {} },
}))
const readWorkflowLogsExecute = vi.fn(async () => ({
  entries: [],
  totalEntries: 0,
  entityId: 'workflow-123',
  retrievedAt: '2026-08-13T00:00:00.000Z',
  truncated: true,
}))
const getIndicatorCatalogExecute = vi.fn(async () => ({
  sections: [],
  items: [],
  count: 0,
}))
const getIndicatorMetadataExecute = vi.fn(async () => ({
  items: [],
  missingIds: [],
}))
const agentAccessoryCatalogResult = { tools: [], skills: [] }
const getAgentAccessoryCatalogExecute = vi.fn(async () => agentAccessoryCatalogResult)
const listGDriveFilesExecute = vi.fn(async () => ({ files: [] }))
const readGDriveFileExecute = vi.fn(async () => ({ content: '' }))
const readCredentialsExecute = vi.fn(async () => ({
  oauth: {
    connected: { credentials: [], total: 0 },
    notConnected: { services: [], total: 0 },
  },
  environment: { variableNames: [], count: 0 },
}))
const readEnvironmentVariablesExecute = vi.fn(async () => ({
  variableNames: [],
  personalVariableNames: [],
  workspaceVariableNames: [],
  conflicts: [],
  count: 0,
}))
const readOAuthCredentialsExecute = vi.fn(async () => ({ credentials: [], total: 0 }))
const setEnvironmentVariablesExecute = vi.fn(async () => ({
  success: true,
  scope: 'workspace',
  message: 'ok',
}))
const searchListingExecute = vi.fn(async () => ({ results: [] }))
const noopEntityExecute = vi.fn(async () => ({}))

const entityTool = (name: string, execute = noopEntityExecute) => ({ name, execute })

vi.mock('@/lib/copilot/tools/server/blocks/get-available-blocks', () => ({
  getAvailableBlocksServerTool: {
    name: 'get_available_blocks',
    execute: vi.fn(async () => ({ blocks: [] })),
  },
}))
vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata', () => ({
  getBlocksMetadataServerTool: {
    name: 'get_blocks_metadata',
    execute: vi.fn(async () => ({ metadata: {} })),
  },
}))
vi.mock('@/lib/copilot/tools/server/agent/get-agent-accessory-catalog', () => ({
  getAgentAccessoryCatalogServerTool: {
    name: 'get_agent_accessory_catalog',
    execute: getAgentAccessoryCatalogExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/indicators/get-indicator-catalog', () => ({
  getIndicatorCatalogServerTool: {
    name: 'get_indicator_catalog',
    execute: getIndicatorCatalogExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/indicators/get-indicator-metadata', () => ({
  getIndicatorMetadataServerTool: {
    name: 'get_indicator_metadata',
    execute: getIndicatorMetadataExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/listing/search-listing', () => ({
  searchListingServerTool: {
    name: 'search_listing',
    execute: searchListingExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/list-files', () => ({
  listGDriveFilesServerTool: { name: 'list_gdrive_files', execute: listGDriveFilesExecute },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/read-file', () => ({
  readGDriveFileServerTool: { name: 'read_gdrive_file', execute: readGDriveFileExecute },
}))
vi.mock('@/lib/copilot/tools/server/knowledge/knowledge-base', () => ({
  listKnowledgeBasesServerTool: {
    name: 'list_knowledge_bases',
    execute: vi.fn(async () => ({ entityKind: 'knowledge_base', entities: [], count: 0 })),
  },
  readKnowledgeBaseServerTool: {
    name: 'read_knowledge_base',
    execute: vi.fn(),
  },
  createKnowledgeBaseServerTool: {
    name: 'create_knowledge_base',
    execute: vi.fn(),
  },
  editKnowledgeBaseServerTool: {
    name: 'edit_knowledge_base',
    execute: vi.fn(),
  },
  renameKnowledgeBaseServerTool: {
    name: 'rename_knowledge_base',
    execute: vi.fn(),
  },
  queryKnowledgeBaseServerTool: {
    name: 'query_knowledge_base',
    execute: vi.fn(),
  },
}))
vi.mock('@/lib/copilot/tools/server/other/make-api-request', () => ({
  makeApiRequestServerTool: {
    name: 'make_api_request',
    execute: vi.fn(async () => ({ success: true })),
  },
}))
vi.mock('@/lib/copilot/tools/server/other/search-online', () => ({
  searchOnlineServerTool: { name: 'search_online', execute: vi.fn(async () => ({ results: [] })) },
}))
vi.mock('@/lib/copilot/tools/server/user/read-credentials', () => ({
  readCredentialsServerTool: { name: 'read_credentials', execute: readCredentialsExecute },
}))
vi.mock('@/lib/copilot/tools/server/user/read-environment-variables', () => ({
  readEnvironmentVariablesServerTool: {
    name: 'read_environment_variables',
    execute: readEnvironmentVariablesExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/user/read-oauth-credentials', () => ({
  readOAuthCredentialsServerTool: {
    name: 'read_oauth_credentials',
    execute: readOAuthCredentialsExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/user/set-environment-variables', () => ({
  setEnvironmentVariablesServerTool: {
    name: 'set_environment_variables',
    execute: setEnvironmentVariablesExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/entities', () => ({
  createCustomToolServerTool: entityTool('create_custom_tool'),
  createIndicatorServerTool: entityTool('create_indicator'),
  createLayoutServerTool: entityTool('create_layout'),
  createMcpServerServerTool: entityTool('create_mcp_server'),
  createSkillServerTool: entityTool('create_skill'),
  createWatchlistServerTool: entityTool('create_watchlist'),
  createWorkflowServerTool: entityTool('create_workflow'),
  editCustomToolServerTool: entityTool('edit_custom_tool'),
  editIndicatorServerTool: entityTool('edit_indicator'),
  editMcpServerServerTool: entityTool('edit_mcp_server'),
  editSkillServerTool: entityTool('edit_skill'),
  editWatchlistServerTool: entityTool('edit_watchlist'),
  editWorkflowVariableServerTool: entityTool('edit_workflow_variable'),
  listCustomToolsServerTool: entityTool('list_custom_tools'),
  listIndicatorsServerTool: entityTool('list_indicators'),
  listLayoutsServerTool: entityTool('list_layout'),
  listMcpServersServerTool: entityTool('list_mcp_servers'),
  listSkillsServerTool: entityTool('list_skills'),
  listWatchlistsServerTool: entityTool('list_watchlist'),
  listWorkflowsServerTool: entityTool('list_workflows'),
  readCustomToolServerTool: entityTool('read_custom_tool'),
  readIndicatorServerTool: entityTool('read_indicator'),
  readLayoutServerTool: entityTool('read_layout'),
  renameLayoutServerTool: entityTool('rename_layout'),
  readMcpServerServerTool: entityTool('read_mcp_server'),
  readSkillServerTool: entityTool('read_skill'),
  readWatchlistServerTool: entityTool('read_watchlist'),
  readWorkflowServerTool: entityTool('read_workflow'),
  renameCustomToolServerTool: entityTool('rename_custom_tool'),
  renameIndicatorServerTool: entityTool('rename_indicator'),
  renameMcpServerServerTool: entityTool('rename_mcp_server'),
  renameSkillServerTool: entityTool('rename_skill'),
  renameWatchlistServerTool: entityTool('rename_watchlist'),
  renameWorkflowServerTool: entityTool('rename_workflow'),
}))
vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow', () => ({
  editWorkflowServerTool: { name: 'edit_workflow', execute: editWorkflowExecute },
}))
vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow-block', () => ({
  editWorkflowBlockServerTool: entityTool('edit_workflow_block'),
}))
vi.mock('@/lib/copilot/tools/server/workflow/read-workflow-logs', () => ({
  readWorkflowLogsServerTool: {
    name: 'read_workflow_logs',
    execute: readWorkflowLogsExecute,
  },
}))

import { FinancialPolicyError, financialFingerprint } from '@tradinggoose/billing'
import { docsEmbeddings } from '@tradinggoose/db/schema'
import { NextRequest } from 'next/server'
import type { FinancialBinding, ModelOccurrence } from '@/lib/billing/native-finance'
import {
  COPILOT_NATIVE_REVISION,
  type Pending,
  parseNativeContract,
} from '@/lib/copilot/native/contract'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { getNativeFinancialSource, NativeTargetError } from '@/lib/copilot/native/target'

const docs = vi.hoisted(() => ({
  actor: 'authenticated-docs-actor',
  workspace: 'conversation-A' as string | null,
  originalNamespace: 'billing-usage:organization:org-A',
  currentNamespace: 'billing-usage:organization:org-A',
  parent: undefined as Pending | undefined,
  session: vi.fn(),
  read: vi.fn(),
  access: vi.fn(),
  verify: vi.fn(),
  create: vi.fn(),
  admit: vi.fn(),
  accept: vi.fn(),
  embed: vi.fn(),
  proof: vi.fn(),
  select: vi.fn(),
  admitted: new Set<string>(),
  vectorFailure: undefined as Error | undefined,
  change: '' as '' | 'create' | 'admit' | 'after-admit' | 'during-contact',
  mutateRead: 0,
  pendingStage: 'result' as 'result' | 'approval',
  abortAfterEmbed: undefined as AbortController | undefined,
}))
vi.mock('@/lib/auth', () => ({ getSession: docs.session }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: docs.access }))
vi.mock('@/lib/copilot/native/client', () => ({ readNativeCopilot: docs.read }))
vi.mock('@/lib/copilot/native/business-access', () => ({
  authorizeNativeBusinessResult: async () => {},
}))
vi.mock('@/lib/copilot/native/readback', () => ({ readbackNativeToolResult: vi.fn() }))
vi.mock('@/lib/copilot/result-proof', () => ({ createCopilotToolResultProof: docs.proof }))
vi.mock('@tradinggoose/db', () => ({ db: { select: docs.select } }))
vi.mock('@/lib/copilot/config', () => ({
  getCopilotConfig: () => ({ rag: { similarityThreshold: 0.3 } }),
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/mastra/connections', () => ({
  // Isolate configured connections; actual installed native registry fallback remains real.
  getConfiguredProviders: () => ({}),
  resolveConfiguredModel: (id: string) => ({ id }),
}))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveOpenAIServiceConfig: async () => ({ defaultApiKey: 'synthetic-docs-key' }),
}))
vi.mock('@mastra/core/llm', async (original) => ({
  ...(await original<typeof import('@mastra/core/llm')>()),
  ModelRouterEmbeddingModel: class {
    maxEmbeddingsPerCall = 1
    doEmbed(input: unknown) {
      return docs.embed(input)
    }
  },
}))
vi.mock('@/lib/billing/native-finance', () => ({
  verifyFinancialAcceptance: docs.verify,
  createFinancialInvocation: docs.create,
  admitFinancialModelStep: docs.admit,
  acceptFinancialModelStep: docs.accept,
}))
let POST: typeof import('./route').POST
let routeExecution: typeof import('@/lib/copilot/tools/server/router').routeExecution
beforeAll(async () => {
  ;({ POST } = await import('./route'))
  ;({ routeExecution } = await import('@/lib/copilot/tools/server/router'))
}, 30000)
function parent(): Pending {
  return {
    target: {
      resourceId: nativeConversationIdentity({
        actorUserId: docs.actor,
        workspaceId: docs.workspace,
      }).resourceId,
      threadId: 'thread',
      runId: 'original-chat-run',
      toolCallId: 'original-docs-call',
      toolName: 'search_documentation',
    },
    stage: docs.pendingStage,
    originalArgs: { query: 'canonical docs' },
    financialBinding: {
      namespace: docs.originalNamespace,
      key: 'original-chat-invocation',
      fingerprint: 'original-chat-fingerprint',
      actorUserId: docs.actor,
      workspaceId: docs.workspace,
      workflowId: null,
      purpose: 'copilot',
      runId: 'original-chat-run',
    },
    financialOccurrence: { runId: 'original-chat-run', stepNumber: 3, retryCount: 0 },
  }
}
async function post(context?: unknown, signal?: AbortSignal) {
  return POST(
    new NextRequest('https://studio.fixture/api/copilot/execute-copilot-server-tool', {
      method: 'POST',
      body: JSON.stringify({
        native: { workspaceId: docs.workspace, target: docs.parent!.target },
        action: 'execute',
        ...(context ? { context } : {}),
      }),
      signal,
    })
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  docs.workspace = 'conversation-A'
  docs.originalNamespace = docs.currentNamespace = 'billing-usage:organization:org-A'
  docs.change = ''
  docs.mutateRead = 0
  docs.pendingStage = 'result'
  docs.abortAfterEmbed = undefined
  docs.vectorFailure = undefined
  docs.admitted.clear()
  docs.parent = parent()
  docs.session.mockResolvedValue({ user: { id: docs.actor } })
  docs.access.mockResolvedValue({ hasAccess: true })
  docs.verify.mockResolvedValue({ accepted: true, modelUsd: 'unavailable', appliedUsd: '0.3' })
  docs.proof.mockResolvedValue('controlled-native-result-proof')
  docs.read.mockImplementation(async (request: any) => {
    const value = structuredClone(docs.parent!)
    if (docs.mutateRead && docs.read.mock.calls.length >= docs.mutateRead)
      value.originalArgs.query = 'changed original query'
    if (docs.pendingStage !== 'result') value.stage = docs.pendingStage
    return {
      status: 200,
      result: await parseNativeContract('CopilotResponse', {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: request.requestId,
        status: 'pending_targets',
        items: [value],
        page: request.page,
        hasMore: false,
      }),
    }
  })
  docs.create.mockImplementation(async (input: any) => {
    if (docs.change === 'create') docs.currentNamespace = 'billing-usage:organization:new-owner'
    if (input.expectedNamespace !== undefined && input.expectedNamespace !== docs.currentNamespace)
      throw new FinancialPolicyError('Original financial payer changed', 403)
    return {
      namespace: docs.currentNamespace,
      key: 'invocation:' + input.operationKey,
      fingerprint: financialFingerprint({
        actor: input.actorUserId,
        workspace: input.workspaceId,
        workflow: input.workflowId,
        run: input.runId,
        purpose: input.purpose,
      }),
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId ?? null,
      workflowId: input.workflowId ?? null,
      runId: input.runId,
      purpose: input.purpose,
    }
  })
  docs.admit.mockImplementation(async (binding: FinancialBinding, occurrence: ModelOccurrence) => {
    if (docs.change === 'admit')
      throw new FinancialPolicyError('Original route no longer authorized', 403)
    const key = JSON.stringify([binding.namespace, binding.key, occurrence])
    if (docs.admitted.has(key))
      throw new FinancialPolicyError('Original child already admitted; no recontact', 409)
    docs.admitted.add(key)
    if (docs.change === 'after-admit')
      docs.currentNamespace = 'billing-usage:organization:new-owner'
  })
  docs.accept.mockResolvedValue(undefined)
  docs.embed.mockImplementation(async () => {
    if (docs.change === 'during-contact')
      docs.currentNamespace = 'billing-usage:organization:new-owner'
    docs.abortAfterEmbed?.abort()
    return { embeddings: [[0.25, 0.5]], usage: { tokens: 12 } }
  })
  docs.select.mockImplementation(() => ({
    from: (table: unknown) => {
      if (table !== docsEmbeddings) throw new Error('Unexpected non-docs vector DB seam')
      return {
        limit: async () => [{ chunkId: 'indexed' }],
        orderBy: () => ({
          limit: async () => {
            if (docs.vectorFailure) throw docs.vectorFailure
            return [
              {
                chunkId: 'one',
                chunkText: 'Exact documentation',
                headerText: 'Title',
                sourceLink: 'https://docs.fixture/one',
                similarity: 0.9,
              },
            ]
          },
        }),
      }
    },
  }))
})
afterEach(() => vi.restoreAllMocks())
describe('native docs trusted finance composition', () => {
  it('keeps global resource access but creates an own org child from authentic Pending, ignoring business workspace', async () => {
    const response = await post({ workspaceId: 'business-B' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      result: { results: [{ content: 'Exact documentation' }] },
    })
    expect(docs.create).toHaveBeenCalledTimes(2)
    expect(docs.create.mock.calls[1][0]).toBe(docs.create.mock.calls[0][0])
    expect(docs.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actorUserId: docs.actor,
        workspaceId: 'conversation-A',
        workflowId: null,
        purpose: 'embedding',
        expectedNamespace: docs.originalNamespace,
        runId: expect.stringMatching(/^embedding-copilot-docs:/),
      })
    )
    const child = docs.create.mock.calls[0][0]
    expect(child.operationKey).toBe(child.runId)
    expect(child.runId).not.toBe(docs.parent!.target.runId)
    expect(docs.admit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ namespace: docs.originalNamespace, purpose: 'embedding' }),
      { runId: child.runId, stepNumber: 0, retryCount: 0 }
    )
    expect(docs.accept).toHaveBeenCalledOnce()
    expect(docs.embed).toHaveBeenCalledOnce()
    expect(docs.verify).toHaveBeenCalledTimes(5)
    for (const call of docs.verify.mock.calls)
      expect(call).toEqual([docs.parent!.financialBinding, docs.parent!.financialOccurrence])
    expect(docs.admit.mock.calls.every(([binding]) => binding.purpose === 'embedding')).toBe(true)
    expect(docs.select).toHaveBeenCalledTimes(2)
  })
  it('keeps same Pending retries on the same child receipt key and refuses a second contact', async () => {
    expect((await post()).status).toBe(200)
    const first = docs.create.mock.calls[0][0]
    expect((await post()).status).toBe(409)
    expect(docs.create).toHaveBeenCalledTimes(3)
    expect(docs.create.mock.calls[2][0].runId).toBe(first.runId)
    expect(docs.create.mock.calls[2][0].operationKey).toBe(first.operationKey)
    expect(docs.embed).toHaveBeenCalledOnce()
    expect(docs.accept).toHaveBeenCalledOnce()
  })
  it.each(['create', 'admit', 'after-admit'] as const)(
    'refuses payer/route change at %s before embedding',
    async (phase) => {
      docs.change = phase
      expect((await post()).status).toBe(403)
      expect(docs.embed).not.toHaveBeenCalled()
      expect(docs.accept).not.toHaveBeenCalled()
      expect(docs.parent!.financialBinding.namespace).toBe(docs.originalNamespace)
    }
  )
  it('settles genuine contacted completion on the original child after payer transfer during doEmbed', async () => {
    docs.change = 'during-contact'
    expect((await post()).status).toBe(200)
    expect(docs.create).toHaveBeenCalledTimes(2)
    expect(docs.create.mock.calls[1][0]).toBe(docs.create.mock.calls[0][0])
    expect(docs.admit).toHaveBeenCalledOnce()
    expect(docs.embed).toHaveBeenCalledOnce()
    expect(docs.accept).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ namespace: docs.originalNamespace, purpose: 'embedding' }),
      expect.objectContaining({
        stepNumber: 0,
        retryCount: 0,
        usage: { inputTokens: 12, totalTokens: 12 },
      })
    )
    expect(docs.parent!.financialBinding.namespace).toBe(docs.originalNamespace)
  })
  it('rechecks exact Pending arguments after awaited source discovery before create', async () => {
    docs.mutateRead = 3
    expect((await post()).status).toBe(409)
    expect(docs.create).not.toHaveBeenCalled()
    expect(docs.embed).not.toHaveBeenCalled()
  })
  it('refuses lost current workspace access without a personal fallback', async () => {
    docs.access
      .mockResolvedValueOnce({ hasAccess: true })
      .mockResolvedValueOnce({ hasAccess: false })
    expect((await post()).status).toBe(403)
    expect(docs.create).not.toHaveBeenCalled()
    expect(docs.embed).not.toHaveBeenCalled()
  })
  it.each(['approval', 'forged-binding', 'forged-actor'])(
    'refuses invalid original native %s before child contact',
    async (kind) => {
      if (kind === 'approval') docs.pendingStage = 'approval'
      if (kind === 'forged-binding') docs.parent!.financialBinding.runId = 'other'
      if (kind === 'forged-actor') docs.parent!.financialBinding.actorUserId = 'other'
      expect((await post()).status).toBeGreaterThanOrEqual(400)
      expect(docs.create).not.toHaveBeenCalled()
      expect(docs.embed).not.toHaveBeenCalled()
    }
  )
  it('refuses serialized financial context and marker/lookalikes without own proof', async () => {
    expect(
      (await post({ workspaceId: 'business-B', financialSource: { accepted: true } })).status
    ).toBe(422)
    expect(
      getNativeFinancialSource({ financialSource: { binding: docs.parent!.financialBinding } })
    ).toBeUndefined()
    await expect(
      routeExecution(
        'search_documentation',
        { query: 'canonical docs' },
        Object.assign(
          {
            userId: docs.actor,
            nativeReviewBinding: 'marker-only',
          },
          { financialSource: { binding: docs.parent!.financialBinding } }
        )
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(docs.create).not.toHaveBeenCalled()
    expect(docs.embed).not.toHaveBeenCalled()
  })
  it.each(['vector', 'proof', 'pending', 'cancel'])(
    'retains completed child accounting on later %s failure without replay',
    async (phase) => {
      const controller = new AbortController()
      if (phase === 'vector') docs.vectorFailure = new Error('Controlled vector failure')
      if (phase === 'proof')
        docs.proof.mockRejectedValueOnce(new NativeTargetError('Controlled proof failure', 409))
      if (phase === 'pending') docs.mutateRead = 5
      if (phase === 'cancel') docs.abortAfterEmbed = controller
      const response = await post(undefined, controller.signal)
      expect(response.status).toBe(phase === 'proof' || phase === 'pending' ? 409 : 500)
      expect(await response.json()).toMatchObject({
        tokens: { prompt: 12, total: 12 },
        cost: { status: 'unavailable' },
        embeddingUsage: { status: phase === 'cancel' ? 'partial' : 'reported', batches: 1 },
      })
      expect(docs.embed).toHaveBeenCalledOnce()
      expect(docs.accept).toHaveBeenCalledOnce()
      expect(docs.create).toHaveBeenCalledTimes(2)
    }
  )
  it('keeps genuine personal native and global standalone docs independent', async () => {
    docs.workspace = null
    docs.originalNamespace = docs.currentNamespace = 'billing-usage:user:' + docs.actor
    docs.parent = parent()
    expect((await post()).status).toBe(200)
    expect(docs.create.mock.calls[0][0]).toMatchObject({
      workspaceId: null,
      expectedNamespace: docs.originalNamespace,
    })
    vi.clearAllMocks()
    await routeExecution(
      'search_documentation',
      { query: 'canonical docs' },
      { userId: docs.actor, workspaceId: 'ignored-resource-scope' }
    )
    expect(docs.create.mock.calls[0][0]).toMatchObject({
      actorUserId: docs.actor,
      workspaceId: undefined,
      purpose: 'embedding',
    })
    expect(docs.create.mock.calls[0][0]).not.toHaveProperty('expectedNamespace')
    expect(docs.verify).not.toHaveBeenCalled()
  })
})
