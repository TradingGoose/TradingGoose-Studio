/** @vitest-environment node */

import { NextRequest } from 'next/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COPILOT_NATIVE_REVISION,
  type CopilotRequest,
  type Pending,
  parseNativeContract,
} from '@/lib/copilot/native/contract'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import * as baseTool from '@/lib/copilot/tools/server/base-tool'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'

const selectMock = vi.fn()
const createLoggerMock = vi.fn(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
const getCopilotConfigMock = vi.fn(() => ({
  rag: {
    similarityThreshold: 0.3,
  },
}))
const generateSearchEmbeddingMock = vi.fn()
const routeExecutionMock = vi.fn()

const nativeReadMock = vi.fn()
const financialVerifyMock = vi.fn()
const businessAccessMock = vi.fn()
const proofMock = vi.fn()
vi.mock('@/lib/auth', () => ({ getSession: async () => ({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/copilot/native/client', () => ({ readNativeCopilot: nativeReadMock }))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: financialVerifyMock }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/copilot/native/business-access', () => ({
  authorizeNativeBusinessResult: businessAccessMock,
}))
vi.mock('@/lib/copilot/native/readback', () => ({ readbackNativeToolResult: vi.fn() }))
vi.mock('@/lib/copilot/result-proof', () => ({ createCopilotToolResultProof: proofMock }))
vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: routeExecutionMock }))
vi.mock('@/lib/copilot/tools/server/review-acceptance', () => ({
  acceptServerManagedToolReview: vi.fn(),
  stageServerManagedToolReview: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: selectMock,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  docsEmbeddings: {
    chunkId: 'docs_embeddings.chunk_id',
    chunkText: 'docs_embeddings.chunk_text',
    sourceDocument: 'docs_embeddings.source_document',
    sourceLink: 'docs_embeddings.source_link',
    headerText: 'docs_embeddings.header_text',
    headerLevel: 'docs_embeddings.header_level',
    embedding: 'docs_embeddings.embedding',
  },
}))

vi.mock('drizzle-orm', () => ({
  sql: (() => 'sql') as unknown,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: createLoggerMock,
}))

vi.mock('@/lib/copilot/config', () => ({
  getCopilotConfig: getCopilotConfigMock,
}))

vi.mock('@/lib/embeddings/utils', () => ({
  generateSearchEmbedding: generateSearchEmbeddingMock,
}))

let searchDocumentationServerTool: typeof import('./search-documentation').searchDocumentationServerTool

beforeAll(async () => {
  ;({ searchDocumentationServerTool } = await import('./search-documentation'))
})

beforeEach(() => {
  vi.clearAllMocks()
  generateSearchEmbeddingMock.mockReset()
  selectMock.mockReset()
  nativeReadMock.mockReset().mockImplementation(async (request: CopilotRequest) => {
    if (request.command !== 'pending.list')
      throw new Error('Unexpected native command in failed docs execution')
    return {
      status: 200,
      result: await parseNativeContract('CopilotResponse', {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: request.requestId,
        status: 'pending_targets',
        items: [pending()],
        page: request.page,
        hasMore: false,
      }),
    }
  })
  financialVerifyMock.mockReset().mockResolvedValue(acceptedCharge)
  businessAccessMock.mockReset().mockResolvedValue(undefined)
  proofMock.mockReset()
})

afterEach(() => vi.restoreAllMocks())

const completed = {
  model: 'openai/text-embedding-3-small',
  tokens: { prompt: 12, total: 12 },
  usage: { status: 'reported' as const, batches: 1 },
  cost: { status: 'unavailable' as const },
}
function ownedEmbedding() {
  return withInferenceFacts(
    { ...completed, embedding: [1, 2] },
    {
      model: completed.model,
      tokens: completed.tokens,
      cost: completed.cost,
      embeddingUsage: completed.usage,
      generatedFields: ['model', 'tokens', 'cost'],
    }
  )
}
const failureAccounting = {
  model: completed.model,
  tokens: completed.tokens,
  embeddingUsage: completed.usage,
  cost: completed.cost,
}

const scope = { actorUserId: 'user-1', workspaceId: null }
const acceptedCharge = Object.freeze({
  accepted: true,
  modelUsd: 'unavailable',
  appliedUsd: '0.025',
})
function pending(): Pending {
  return {
    target: {
      resourceId: nativeConversationIdentity(scope).resourceId,
      threadId: 'thread',
      runId: 'native-run',
      toolCallId: 'docs-call',
      toolName: searchDocumentationServerTool.name,
    },
    stage: 'result',
    originalArgs: { query: 'docs' },
    financialBinding: {
      namespace: 'billing-usage:original-root',
      key: 'original-operation',
      fingerprint: 'original-fingerprint',
      actorUserId: 'user-1',
      workspaceId: null,
      workflowId: null,
      runId: 'native-run',
      purpose: 'copilot',
    },
    financialOccurrence: { runId: 'native-run', stepNumber: 3, retryCount: 0 },
  }
}

function mockIndexedSearch(queryResult: () => Promise<unknown[]>) {
  selectMock
    .mockReturnValueOnce({ from: () => ({ limit: async () => [{ chunkId: 'chunk-1' }] }) })
    .mockReturnValueOnce({
      from: () => ({ orderBy: () => ({ limit: queryResult }) }),
    })
}

describe('searchDocumentationServerTool', () => {
  it('returns completed native accounting once across multiple matching documentation chunks', async () => {
    mockIndexedSearch(async () => [{ similarity: 0.9 }, { similarity: 0.8 }])
    generateSearchEmbeddingMock.mockResolvedValue(ownedEmbedding())

    const result = await searchDocumentationServerTool.execute(
      { query: 'workflow docs' },
      { userId: 'user-1' }
    )

    expect(result.totalResults).toBe(2)
    expect(result.embeddingUsage).toEqual(completed)
    expect(generateSearchEmbeddingMock).toHaveBeenCalledTimes(1)
  })

  for (const scenario of ['post-embedding abort', 'vector query rejection'] as const) {
    it(`preserves original error identity and safe completed accounting on ${scenario}`, async () => {
      const controller = new AbortController()
      const databaseError = Object.assign(new Error('private database failure'), {
        statusCode: 503,
        apiKey: 'private-key',
        request: { authorization: 'private-authorization' },
      })
      const queryResult = async () => {
        if (scenario === 'vector query rejection') throw databaseError
        return []
      }
      mockIndexedSearch(queryResult)
      generateSearchEmbeddingMock.mockImplementation(async () => {
        if (scenario === 'post-embedding abort') controller.abort()
        return ownedEmbedding()
      })
      const abortCheck = vi.spyOn(baseTool, 'throwIfServerToolAborted')
      const error = await searchDocumentationServerTool
        .execute({ query: 'workflow docs' }, { userId: 'user-1', signal: controller.signal })
        .catch((failure) => failure)

      if (scenario === 'post-embedding abort') {
        expect(error.name).toBe('AbortError')
        expect(error).toBe(abortCheck.mock.results.at(-1)?.value)
      } else {
        expect(error).toBe(databaseError)
      }
      const facts = getInferenceFacts(error)
      expect(facts).toMatchObject({
        model: completed.model,
        tokens: completed.tokens,
        embeddingUsage: completed.usage,
      })
      const accounting = getFailureAccounting(error)
      expect(Object.fromEntries(Object.entries(accounting))).toEqual(failureAccounting)
      expect(getInferenceFacts(accounting)).toBe(facts)
      const response = buildCopilotServerToolErrorResponse('search_documentation', error)
      expect(response.status).toBe(500)
      expect(Object.fromEntries(Object.entries(response.body))).toEqual({
        code: 'server_tool_execution_failed',
        error: 'Server tool execution failed',
        retryable: false,
        ...failureAccounting,
      })
      expect(getInferenceFacts(response.body)).toBe(facts)
      expect(generateSearchEmbeddingMock).toHaveBeenCalledTimes(1)
      expect(selectMock).toHaveBeenCalledTimes(scenario === 'post-embedding abort' ? 1 : 2)
    })

    it(`retains completed accounting through the actual HTTP caller on ${scenario}`, async () => {
      const controller = new AbortController()
      const queryResult = async () => {
        if (scenario === 'vector query rejection') throw new Error('private database failure')
        return []
      }
      mockIndexedSearch(queryResult)
      generateSearchEmbeddingMock.mockImplementation(async () => {
        if (scenario === 'post-embedding abort') controller.abort()
        return ownedEmbedding()
      })
      routeExecutionMock.mockImplementation((_name, params, context) =>
        searchDocumentationServerTool.execute(params, context)
      )
      const { POST } = await import('@/app/api/copilot/execute-copilot-server-tool/route')
      const originalPending = pending()
      const request = new NextRequest(
        'https://studio.example.test/api/copilot/execute-copilot-server-tool',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            native: { workspaceId: null, target: originalPending.target },
            action: 'execute',
          }),
          signal: controller.signal,
        }
      )
      const response = await POST(request)

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        code: 'server_tool_execution_failed',
        error: 'Server tool execution failed',
        retryable: false,
        ...failureAccounting,
      })
      expect(generateSearchEmbeddingMock).toHaveBeenCalledExactlyOnceWith('docs', {
        actorUserId: 'user-1',
        workspaceId: null,
        workflowId: null,
        signal: request.signal,
        runId: expect.stringMatching(/^embedding-copilot-docs:/),
        expectedNamespace: originalPending.financialBinding.namespace,
        verifySource: expect.any(Function),
      })
      expect(nativeReadMock).toHaveBeenCalledTimes(2)
      expect(financialVerifyMock).toHaveBeenCalledTimes(2)
      for (const call of financialVerifyMock.mock.calls)
        expect(call).toEqual([
          originalPending.financialBinding,
          originalPending.financialOccurrence,
        ])
      expect(await financialVerifyMock.mock.results[0]!.value).toEqual(acceptedCharge)
      expect(acceptedCharge.appliedUsd).toBe('0.025')
      expect(financialVerifyMock.mock.invocationCallOrder[0]).toBeLessThan(
        generateSearchEmbeddingMock.mock.invocationCallOrder[0]!
      )
      expect(businessAccessMock).toHaveBeenCalledExactlyOnceWith(
        scope,
        originalPending,
        undefined,
        expect.objectContaining({ userId: 'user-1', signal: request.signal })
      )
      expect(proofMock).not.toHaveBeenCalled()
      expect(selectMock).toHaveBeenCalledTimes(scenario === 'post-embedding abort' ? 1 : 2)
    })
  }

  it('returns an empty result without generating embeddings when no docs are indexed', async () => {
    const limitMock = vi.fn().mockResolvedValue([])
    const fromMock = vi.fn(() => ({
      limit: limitMock,
    }))
    selectMock.mockReturnValue({
      from: fromMock,
    })

    const result = await searchDocumentationServerTool.execute(
      { query: 'workflow edge docs' },
      { userId: 'user-1' }
    )

    expect(result).toEqual({
      results: [],
      query: 'workflow edge docs',
      totalResults: 0,
    })
    expect(generateSearchEmbeddingMock).not.toHaveBeenCalled()
  })

  it('returns a structured unavailable error when docs exist but embeddings are not configured', async () => {
    const limitMock = vi.fn().mockResolvedValue([{ chunkId: 'chunk-1' }])
    const fromMock = vi.fn(() => ({
      limit: limitMock,
    }))
    selectMock.mockReturnValue({
      from: fromMock,
    })
    generateSearchEmbeddingMock.mockRejectedValue(
      new Error('API key not found for provider openai. Set OPENAI_API_KEY environment variable.')
    )

    await expect(
      searchDocumentationServerTool.execute({ query: 'workflow edge docs' }, { userId: 'user-1' })
    ).rejects.toMatchObject({
      name: 'StructuredServerToolError',
      status: 503,
      code: 'search_documentation_unavailable',
      message: 'Documentation search is unavailable because no embedding provider is configured.',
      retryable: false,
    })
  })

  it('returns a structured backend error when embedding generation fails upstream', async () => {
    const limitMock = vi.fn().mockResolvedValue([{ chunkId: 'chunk-1' }])
    const fromMock = vi.fn(() => ({
      limit: limitMock,
    }))
    selectMock.mockReturnValue({
      from: fromMock,
    })
    generateSearchEmbeddingMock.mockRejectedValue(
      Object.assign(new Error('Service Unavailable'), { statusCode: 503 })
    )

    await expect(
      searchDocumentationServerTool.execute({ query: 'workflow edge docs' }, { userId: 'user-1' })
    ).rejects.toMatchObject({
      name: 'StructuredServerToolError',
      status: 503,
      code: 'search_documentation_backend_failed',
      message: 'Documentation search failed while generating the query embedding.',
      retryable: true,
    })
  })
})

it('refuses native marker and lookalike provenance before index or embedding contact', async () => {
  const context = Object.assign(
    { userId: 'user-1', nativeReviewBinding: 'marker-only' },
    {
      financialSource: { actorUserId: 'user-1', namespace: 'forged', accepted: true },
    }
  )
  await expect(
    searchDocumentationServerTool.execute({ query: 'docs' }, context)
  ).rejects.toMatchObject({ status: 403 })
  expect(selectMock).not.toHaveBeenCalled()
  expect(generateSearchEmbeddingMock).not.toHaveBeenCalled()
})
it('returns the original functional wrapper plus genuine private embedding facts', async () => {
  mockIndexedSearch(async () => [])
  const embedding = ownedEmbedding()
  generateSearchEmbeddingMock.mockResolvedValueOnce(embedding)
  const result = await searchDocumentationServerTool.execute(
    { query: 'docs' },
    { userId: 'user-1' }
  )
  expect(result).toMatchObject({
    results: [],
    query: 'docs',
    totalResults: 0,
    embeddingUsage: completed,
  })
  expect(getInferenceFacts(result)).toMatchObject({
    tokens: completed.tokens,
    embeddingUsage: completed.usage,
    generatedFields: expect.arrayContaining(['embeddingUsage']),
  })
})
