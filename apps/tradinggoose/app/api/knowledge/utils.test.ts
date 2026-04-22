/**
 * @vitest-environment node
 *
 * Knowledge Utils Unit Tests
 *
 * This file contains unit tests for the knowledge base utility functions,
 * including access checks, document processing, and embedding generation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveAzureOpenAIServiceConfig, resolveOpenAIServiceConfig } = vi.hoisted(() => ({
  resolveAzureOpenAIServiceConfig: vi.fn(),
  resolveOpenAIServiceConfig: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: any[]) => args,
  asc: (...args: any[]) => args,
  desc: (...args: any[]) => args,
  eq: (...args: any[]) => args,
  inArray: (...args: any[]) => args,
  isNull: () => true,
  sql: (strings: TemplateStringsArray, ...expr: any[]) => ({ strings, expr }),
}))

vi.mock('@/lib/env', () => ({
  env: {},
  getEnv: (key: string) => process.env[key],
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value === 'true' || value === '1' : Boolean(value),
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureOpenAIServiceConfig,
  resolveOpenAIServiceConfig,
}))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  retryWithExponentialBackoff: (fn: any) => fn(),
}))

vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: vi.fn().mockResolvedValue({
    chunks: [
      {
        text: 'alpha',
        tokenCount: 1,
        metadata: { startIndex: 0, endIndex: 4 },
      },
      {
        text: 'beta',
        tokenCount: 1,
        metadata: { startIndex: 5, endIndex: 8 },
      },
    ],
    metadata: {
      filename: 'dummy',
      fileSize: 10,
      mimeType: 'text/plain',
      characterCount: 9,
      tokenCount: 3,
      chunkCount: 2,
      processingMethod: 'file-parser',
    },
  }),
}))

const dbOps: {
  order: string[]
  insertRecords: any[][]
  updatePayloads: any[]
} = {
  order: [],
  insertRecords: [],
  updatePayloads: [],
}

let kbRows: any[] = []
let docRows: any[] = []
let chunkRows: any[] = []

function resetDatasets() {
  kbRows = []
  docRows = []
  chunkRows = []
}

vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { embedding: [0.1, 0.2], index: 0 },
        { embedding: [0.3, 0.4], index: 1 },
      ],
    }),
  })
)

vi.mock('@tradinggoose/db', () => {
  function resolveRows(table: any, n: number) {
    const tableSymbols = Object.getOwnPropertySymbols(table || {})
    const baseNameSymbol = tableSymbols.find((s) => s.toString().includes('BaseName'))
    const tableName = baseNameSymbol ? table[baseNameSymbol] : ''

    if (tableName === 'knowledge_base') {
      return Promise.resolve(kbRows.slice(0, n))
    }
    if (tableName === 'document') {
      return Promise.resolve(docRows.slice(0, n))
    }
    if (tableName === 'embedding') {
      return Promise.resolve(chunkRows.slice(0, n))
    }

    return Promise.resolve([])
  }

  const selectBuilder = {
    from(table: any) {
      const withLimit = {
        limit(n: number) {
          return resolveRows(table, n)
        },
      }

      return {
        where() {
          return {
            ...withLimit,
            orderBy() {
              return withLimit
            },
          }
        },
      }
    },
  }

  return {
    db: {
      select: vi.fn(() => selectBuilder),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
      transaction: vi.fn(async (fn: any) => {
        await fn({
          select: vi.fn(() => selectBuilder),
          insert: (table: any) => ({
            values: (records: any) => {
              dbOps.order.push('insert')
              dbOps.insertRecords.push(records)
              return Promise.resolve()
            },
          }),
          update: () => ({
            set: (payload: any) => ({
              where: () => {
                dbOps.updatePayloads.push(payload)
                const label = dbOps.updatePayloads.length === 1 ? 'updateDoc' : 'updateKb'
                dbOps.order.push(label)
                return Promise.resolve()
              },
            }),
          }),
        })
      }),
    },
    document: {},
    knowledgeBase: {},
    embedding: {},
  }
})

import { generateEmbeddings } from '@/lib/embeddings/utils'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import {
  checkChunkAccess,
  checkDocumentAccess,
  checkKnowledgeBaseAccess,
} from '@/app/api/knowledge/utils'

describe('Knowledge Utils', () => {
  beforeEach(() => {
    dbOps.order.length = 0
    dbOps.insertRecords.length = 0
    dbOps.updatePayloads.length = 0
    resetDatasets()
    vi.clearAllMocks()
    resolveAzureOpenAIServiceConfig.mockReset()
    resolveOpenAIServiceConfig.mockReset()
    resolveAzureOpenAIServiceConfig.mockResolvedValue({
      apiKey: null,
      endpoint: null,
      apiVersion: '2024-07-01-preview',
      embeddingModel: null,
    })
    resolveOpenAIServiceConfig.mockResolvedValue({
      defaultApiKey: 'test-key',
      rotationKeys: [],
    })
  })

  describe('processDocumentAsync', () => {
    it.concurrent('should insert embeddings before updating document counters', async () => {
      docRows.push({ id: 'doc1', deletedAt: null })

      await processDocumentAsync(
        'kb1',
        'doc1',
        {
          filename: 'file.txt',
          fileUrl: 'https://example.com/file.txt',
          fileSize: 10,
          mimeType: 'text/plain',
        },
        {}
      )

      expect(dbOps.order).toEqual(['insert', 'updateDoc'])

      expect(dbOps.updatePayloads[0]).toMatchObject({
        processingStatus: 'completed',
        chunkCount: 2,
      })

      expect(dbOps.insertRecords[0].length).toBe(2)
    })
  })

  describe('checkKnowledgeBaseAccess', () => {
    it.concurrent('should return success for owner', async () => {
      kbRows.push({ id: 'kb1', userId: 'user1' })
      const result = await checkKnowledgeBaseAccess('kb1', 'user1')

      expect(result.hasAccess).toBe(true)
    })

    it('should return notFound when knowledge base is missing', async () => {
      const result = await checkKnowledgeBaseAccess('missing', 'user1')

      expect(result.hasAccess).toBe(false)
      expect('notFound' in result && result.notFound).toBe(true)
    })
  })

  describe('checkDocumentAccess', () => {
    it.concurrent('should return unauthorized when user mismatch', async () => {
      kbRows.push({ id: 'kb1', userId: 'owner' })
      const result = await checkDocumentAccess('kb1', 'doc1', 'intruder')

      expect(result.hasAccess).toBe(false)
      if ('reason' in result) {
        expect(result.reason).toBe('Unauthorized knowledge base access')
      }
    })
  })

  describe('checkChunkAccess', () => {
    it.concurrent('should fail when document is not completed', async () => {
      kbRows.push({ id: 'kb1', userId: 'user1' })
      docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'processing' })

      const result = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')

      expect(result.hasAccess).toBe(false)
      if ('reason' in result) {
        expect(result.reason).toContain('Document is not ready')
      }
    })

    it('should return success for valid access', async () => {
      kbRows.push({ id: 'kb1', userId: 'user1' })
      docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'completed' })
      chunkRows.push({ id: 'chunk1', documentId: 'doc1' })

      const result = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')

      expect(result.hasAccess).toBe(true)
      if ('chunk' in result) {
        expect(result.chunk.id).toBe('chunk1')
      }
    })
  })

  describe('generateEmbeddings', () => {
    it.concurrent('should return same length as input', async () => {
      const result = await generateEmbeddings(['a', 'b'])

      expect(result.length).toBe(2)
    })

    it('should use Azure OpenAI when Azure config is provided', async () => {
      resolveAzureOpenAIServiceConfig.mockResolvedValue({
        apiKey: 'test-azure-key',
        endpoint: 'https://test.openai.azure.com',
        apiVersion: '2024-12-01-preview',
        embeddingModel: 'text-embedding-ada-002',
      })
      resolveOpenAIServiceConfig.mockResolvedValue({
        defaultApiKey: 'test-openai-key',
        rotationKeys: [],
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2], index: 0 }],
        }),
      } as any)

      await generateEmbeddings(['test text'])

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/text-embedding-ada-002/embeddings?api-version=2024-12-01-preview',
        expect.objectContaining({
          headers: expect.objectContaining({
            'api-key': 'test-azure-key',
          }),
        })
      )
    })

    it('should fallback to OpenAI when no Azure config provided', async () => {
      resolveOpenAIServiceConfig.mockResolvedValue({
        defaultApiKey: 'test-openai-key',
        rotationKeys: [],
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2], index: 0 }],
        }),
      } as any)

      await generateEmbeddings(['test text'])

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-key',
          }),
        })
      )
    })

    it('should throw error when no API configuration provided', async () => {
      resolveOpenAIServiceConfig.mockResolvedValue({
        defaultApiKey: null,
        rotationKeys: [],
      })

      await expect(generateEmbeddings(['test text'])).rejects.toThrow(
        'Either the OpenAI default API key or Azure OpenAI service config must be configured'
      )
    })
  })
})
