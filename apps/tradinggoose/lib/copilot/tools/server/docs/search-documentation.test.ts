/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import * as baseTool from '@/lib/copilot/tools/server/base-tool'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'

const m = vi.hoisted(() => ({
  select: vi.fn(),
  embedding: vi.fn(),
  authorize: vi.fn(),
  acceptance: vi.fn(),
  sources: new WeakMap<object, any>(),
}))
vi.mock('@tradinggoose/db', () => ({ db: { select: m.select } }))
vi.mock('@tradinggoose/db/schema', () => ({ docsEmbeddings: {} }))
vi.mock('drizzle-orm', () => ({ sql: () => 'sql' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/copilot/config', () => ({
  getCopilotConfig: () => ({ rag: { similarityThreshold: 0.3 } }),
}))
vi.mock('@/lib/embeddings/utils', () => ({ generateSearchEmbedding: m.embedding }))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: m.acceptance }))
vi.mock('@/lib/copilot/native/target', async () => {
  const { NativeTargetError } = await import('@/lib/copilot/native/errors')
  return {
    NativeTargetError,
    getNativeFinancialSource: (context: object) => m.sources.get(context),
    authorizeNativeConversationScope: m.authorize,
  }
})

import { searchDocumentationServerTool } from './search-documentation'

const completed = {
  model: 'openai/text-embedding-3-small',
  tokens: { prompt: 12, total: 12 },
  usage: { status: 'reported' as const, batches: 1 },
  cost: { status: 'unavailable' as const },
}
const accounting = {
  model: completed.model,
  tokens: completed.tokens,
  embeddingUsage: completed.usage,
  cost: completed.cost,
}
function ownedEmbedding() {
  return withInferenceFacts(
    { ...completed, embedding: [1, 2] },
    {
      ...accounting,
      generatedFields: ['model', 'tokens', 'cost'],
    }
  )
}
function mockIndexedSearch(queryResult: () => Promise<unknown[]> = async () => []) {
  m.select
    .mockReturnValueOnce({ from: () => ({ limit: async () => [{ chunkId: 'chunk-1' }] }) })
    .mockReturnValueOnce({ from: () => ({ orderBy: () => ({ limit: queryResult }) }) })
}
function sourceContext() {
  const controller = new AbortController()
  const context = {
    userId: 'user-1',
    nativeReviewBinding: 'local-tool-binding',
    signal: controller.signal,
  }
  const source = {
    scope: { actorUserId: context.userId, workspaceId: 'workspace-1' },
    target: { runId: 'run-1', toolCallId: 'call-1', toolName: 'search_documentation' },
    originalArgsJson: JSON.stringify({ query: 'docs' }),
    binding: {
      actorUserId: context.userId,
      workspaceId: 'workspace-1',
      workflowId: null,
      namespace: 'billing-usage:user:user-1',
    },
    occurrence: { runId: 'run-1', stepNumber: 2, retryCount: 0 },
    signal: context.signal,
  }
  m.sources.set(context, source)
  return { context, source, controller }
}
beforeEach(() => {
  vi.clearAllMocks()
  m.select.mockReset()
  m.embedding.mockReset()
  m.authorize.mockResolvedValue(undefined)
  m.acceptance.mockResolvedValue({ accepted: true, appliedUsd: '0.025' })
})
afterEach(() => vi.restoreAllMocks())

describe('documentation search accounting', () => {
  it('returns one embedding charge across multiple matching chunks', async () => {
    mockIndexedSearch(async () => [{ similarity: 0.9 }, { similarity: 0.8 }])
    m.embedding.mockResolvedValue(ownedEmbedding())
    const result = await searchDocumentationServerTool.execute(
      { query: 'workflow docs' },
      { userId: 'user-1' }
    )
    expect(result.totalResults).toBe(2)
    expect(result.embeddingUsage).toEqual(completed)
    expect(m.embedding).toHaveBeenCalledTimes(1)
    expect(getInferenceFacts(result)).toMatchObject({
      ...accounting,
      generatedFields: expect.arrayContaining(['embeddingUsage']),
    })
  })

  it.each(['post-embedding abort', 'vector query rejection'] as const)(
    'preserves completed accounting on %s',
    async (scenario) => {
      const controller = new AbortController()
      const databaseError = Object.assign(new Error('private database failure'), {
        statusCode: 503,
        apiKey: 'private-key',
      })
      mockIndexedSearch(async () => {
        if (scenario === 'vector query rejection') throw databaseError
        return []
      })
      m.embedding.mockImplementation(async () => {
        if (scenario === 'post-embedding abort') controller.abort()
        return ownedEmbedding()
      })
      const abortCheck = vi.spyOn(baseTool, 'throwIfServerToolAborted')
      const error = await searchDocumentationServerTool
        .execute({ query: 'docs' }, { userId: 'user-1', signal: controller.signal })
        .catch((failure) => failure)
      if (scenario === 'post-embedding abort') {
        expect(error.name).toBe('AbortError')
        expect(error).toBe(abortCheck.mock.results.at(-1)?.value)
      } else {
        expect(error).toBe(databaseError)
      }
      expect(Object.fromEntries(Object.entries(getFailureAccounting(error)))).toEqual(accounting)
      const response = buildCopilotServerToolErrorResponse('search_documentation', error)
      expect(response.status).toBe(500)
      expect(Object.fromEntries(Object.entries(response.body))).toEqual({
        code: 'server_tool_execution_failed',
        error: 'Server tool execution failed',
        retryable: false,
        ...accounting,
      })
      expect(m.embedding).toHaveBeenCalledTimes(1)
    }
  )

  it('skips model contact when no documentation is indexed', async () => {
    m.select.mockReturnValue({ from: () => ({ limit: async () => [] }) })
    await expect(
      searchDocumentationServerTool.execute({ query: 'docs' }, { userId: 'user-1' })
    ).resolves.toEqual({ results: [], query: 'docs', totalResults: 0 })
    expect(m.embedding).not.toHaveBeenCalled()
  })

  it.each([
    [
      new Error('API key not found for provider openai'),
      'search_documentation_unavailable',
      503,
      false,
    ],
    [
      Object.assign(new Error('upstream unavailable'), { statusCode: 503 }),
      'search_documentation_backend_failed',
      503,
      true,
    ],
  ] as const)(
    'returns structured errors for embedding failures',
    async (error, code, status, retryable) => {
      mockIndexedSearch()
      m.embedding.mockRejectedValue(error)
      await expect(
        searchDocumentationServerTool.execute({ query: 'docs' }, { userId: 'user-1' })
      ).rejects.toMatchObject({ name: 'StructuredServerToolError', code, status, retryable })
    }
  )
})

describe('local Copilot documentation context', () => {
  it('uses the original billing namespace and verifies current access without remote discovery', async () => {
    const { context, source } = sourceContext()
    mockIndexedSearch()
    m.embedding.mockResolvedValue(ownedEmbedding())
    await searchDocumentationServerTool.execute({ query: 'docs' }, context)
    expect(m.authorize).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(m.acceptance).toHaveBeenCalledWith(source.binding, source.occurrence)
    expect(m.embedding).toHaveBeenCalledWith('docs', {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: null,
      signal: context.signal,
      runId: expect.stringMatching(/^embedding-copilot-docs:/),
      expectedNamespace: source.binding.namespace,
      verifySource: expect.any(Function),
    })
    m.authorize.mockRejectedValueOnce(new Error('access revoked'))
    await expect(m.embedding.mock.calls[0][1].verifySource()).rejects.toThrow('access revoked')
  })

  it('refuses marker-only financial context before database or embedding contact', async () => {
    await expect(
      searchDocumentationServerTool.execute(
        { query: 'docs' },
        { userId: 'user-1', nativeReviewBinding: 'forged-marker' }
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(m.select).not.toHaveBeenCalled()
    expect(m.embedding).not.toHaveBeenCalled()
  })

  it('refuses changed arguments before database or embedding contact', async () => {
    const { context } = sourceContext()
    await expect(
      searchDocumentationServerTool.execute({ query: 'changed' }, context)
    ).rejects.toMatchObject({ status: 403 })
    expect(m.select).not.toHaveBeenCalled()
    expect(m.embedding).not.toHaveBeenCalled()
  })
})
