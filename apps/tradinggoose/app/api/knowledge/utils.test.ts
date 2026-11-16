/**
 * @vitest-environment node
 *
 * Knowledge Utils Unit Tests
 *
 * This file contains unit tests for the knowledge base utility functions,
 * including access checks, document processing, and embedding generation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUserEntityPermissions = vi.hoisted(() => vi.fn())

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

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
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

vi.mock('@/lib/embeddings/utils', () => ({
  generateEmbeddings: vi.fn(async (texts: string[], _scope: unknown, model: string) => ({
    embeddings: texts.map((_, index) => [index + 0.1, index + 0.2]),
    model,
    tokens: { prompt: texts.length, total: texts.length },
    usage: { status: 'reported', batches: 1 },
    cost: { status: 'unavailable' },
  })),
}))

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
            for() {
              return withLimit
            },
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
        return fn({
          select: vi.fn(() => selectBuilder),
          delete: () => ({ where: async () => dbOps.order.push('deleteEmbeddings') }),
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
                dbOps.order.push('update')
                return {
                  returning: () =>
                    Promise.resolve(
                      payload.processingStatus === 'failed' &&
                        !docRows.some(
                          (row) =>
                            row.id === 'doc1' &&
                            !row.deletedAt &&
                            ['pending', 'processing'].includes(row.processingStatus)
                        )
                        ? []
                        : [{ id: 'doc1' }]
                    ),
                }
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

import { processDocument } from '@/lib/knowledge/documents/document-processor'
import {
  markDocumentProcessingFailed,
  processDocumentAsync,
} from '@/lib/knowledge/documents/service'
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
  })

  describe('processDocumentAsync', () => {
    beforeEach(() => mockGetUserEntityPermissions.mockResolvedValue('write'))
    afterEach(() => mockGetUserEntityPermissions.mockReset())
    it('resets persisted embeddings before processing native batches', async () => {
      kbRows.push({ id: 'kb1', workspaceId: 'workspace-1', embeddingModel: 'kb-embedding-model' })
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
        {
          chunkSize: 512,
          minCharactersPerChunk: 1,
          chunkOverlap: 200,
        },
        { actorUserId: 'actor-1', workspaceId: 'workspace-1' }
      )

      expect(processDocument).toHaveBeenCalledExactlyOnceWith(
        'https://example.com/file.txt',
        'file.txt',
        'text/plain',
        'actor-1',
        512,
        200,
        1
      )
      expect(dbOps.order).toEqual(['deleteEmbeddings', 'update', 'insert', 'update'])

      expect(dbOps.updatePayloads[0]).toMatchObject({
        processingStatus: 'processing',
        chunkCount: 0,
      })
      expect(dbOps.updatePayloads[1]).toMatchObject({
        processingStatus: 'completed',
        chunkCount: 2,
      })

      expect(dbOps.insertRecords[0].length).toBe(2)
      expect(dbOps.insertRecords[0][0].embeddingModel).toBe('kb-embedding-model')
      const { generateEmbeddings } = await import('@/lib/embeddings/utils')
      expect(generateEmbeddings).toHaveBeenCalledExactlyOnceWith(
        ['alpha', 'beta'],
        expect.objectContaining({
          actorUserId: 'actor-1',
          workspaceId: 'workspace-1',
          runId: 'embedding-document:doc1:1',
        }),
        'kb-embedding-model'
      )
    })

    it('should clear persisted embeddings when processing is marked failed', async () => {
      docRows.push({ id: 'doc1', deletedAt: null, processingStatus: 'processing' })

      await markDocumentProcessingFailed('doc1', 'Embedding timeout')

      expect(dbOps.order).toEqual(['update', 'deleteEmbeddings'])
      expect(dbOps.updatePayloads[0]).toMatchObject({
        processingStatus: 'failed',
        processingError: 'Embedding timeout',
      })
    })

    it('should clear persisted embeddings when processing fails after document deletion', async () => {
      await markDocumentProcessingFailed('doc1', 'Embedding timeout')

      expect(dbOps.order).toEqual(['update', 'deleteEmbeddings'])
      expect(dbOps.updatePayloads[0]).toMatchObject({
        processingStatus: 'failed',
        processingError: 'Embedding timeout',
      })
    })
  })

  describe('checkKnowledgeBaseAccess', () => {
    it('should return success for workspace permission', async () => {
      kbRows.push({ id: 'kb1', userId: 'owner', workspaceId: 'workspace1' })
      const result = await checkKnowledgeBaseAccess('kb1', 'user1')

      expect(result.hasAccess).toBe(true)
      expect(mockGetUserEntityPermissions).toHaveBeenCalledWith('user1', 'workspace', 'workspace1')
    })

    it('should return notFound when knowledge base is missing', async () => {
      const result = await checkKnowledgeBaseAccess('missing', 'user1')

      expect(result.hasAccess).toBe(false)
      expect('notFound' in result && result.notFound).toBe(true)
    })
  })

  describe('checkDocumentAccess', () => {
    it('should return unauthorized when user mismatch', async () => {
      kbRows.push({ id: 'kb1', userId: 'owner', workspaceId: 'workspace1' })
      mockGetUserEntityPermissions.mockResolvedValueOnce(null)
      const result = await checkDocumentAccess('kb1', 'doc1', 'intruder')

      expect(result.hasAccess).toBe(false)
      if ('reason' in result) {
        expect(result.reason).toBe('Unauthorized knowledge base access')
      }
    })
  })

  describe('checkChunkAccess', () => {
    it('should fail when document is not completed', async () => {
      kbRows.push({ id: 'kb1', userId: 'user1', workspaceId: 'workspace1' })
      docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'processing' })

      const result = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')

      expect(result.hasAccess).toBe(false)
      if ('reason' in result) {
        expect(result.reason).toContain('Document is not ready')
      }
    })

    it('should return success for valid access', async () => {
      kbRows.push({ id: 'kb1', userId: 'user1', workspaceId: 'workspace1' })
      docRows.push({ id: 'doc1', knowledgeBaseId: 'kb1', processingStatus: 'completed' })
      chunkRows.push({ id: 'chunk1', documentId: 'doc1' })

      const result = await checkChunkAccess('kb1', 'doc1', 'chunk1', 'user1')

      expect(result.hasAccess).toBe(true)
      if ('chunk' in result) {
        expect(result.chunk.id).toBe('chunk1')
      }
    })
  })
})
