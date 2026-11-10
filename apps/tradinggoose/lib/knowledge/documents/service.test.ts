/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  queuedDelete: vi.fn(),
  cleanup: vi.fn(),
  decrement: vi.fn(),
  access: vi.fn(),
  process: vi.fn(),
}))
const tables = {
  document: {
    id: 'doc.id',
    deletedAt: 'doc.deletedAt',
    knowledgeBaseId: 'doc.kb',
    fileUrl: 'doc.url',
    fileSize: 'doc.size',
  },
  embedding: { documentId: 'embedding.doc' },
  knowledgeBase: { id: 'kb.id', userId: 'kb.user', workspaceId: 'kb.workspace' },
  pendingExecution: { executionType: 'pending.type', id: 'pending.id' },
  knowledgeBaseTagDefinitions: {},
}
vi.mock('@tradinggoose/db', () => ({
  db: { select: mocks.select, transaction: mocks.transaction, delete: mocks.queuedDelete },
}))
vi.mock('@tradinggoose/db/schema', () => tables)
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@/app/api/knowledge/utils', () => ({ checkKnowledgeBaseWriteAccess: mocks.access }))
vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: vi.fn(),
  incrementStorageUsage: vi.fn(),
  decrementStorageUsage: mocks.decrement,
}))
vi.mock('@/lib/embeddings/utils', () => ({ generateEmbeddings: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/execution/pending-execution', () => ({ enqueuePendingExecution: vi.fn() }))
vi.mock('@/lib/knowledge/consts', () => ({ getSlotsForFieldType: vi.fn() }))
vi.mock('@/lib/knowledge/documents/document-processor', () => ({ processDocument: mocks.process }))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://app.fixture' }))
vi.mock('@/lib/knowledge/documents/storage', async (original) => ({
  ...(await original<typeof import('@/lib/knowledge/documents/storage')>()),
  deleteKnowledgeDocumentFiles: mocks.cleanup,
}))
vi.mock('@/lib/knowledge/tags/service', () => ({ getNextAvailableSlot: vi.fn() }))
vi.mock('@/lib/mastra/errors', () => ({ getFailureAccounting: vi.fn() }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))

const firstUrl = '/api/files/serve/s3/first.pdf?context=knowledge-base'
const secondUrl = '/api/files/serve/s3/second.pdf?context=knowledge-base'
const targets = [
  { id: 'doc-1', knowledgeBaseId: 'kb-1', fileUrl: firstUrl, fileSize: 3 },
  { id: 'doc-2', knowledgeBaseId: 'kb-1', fileUrl: secondUrl, fileSize: 4 },
]
function selection(rows: unknown[]) {
  const promise = Promise.resolve(rows)
  return {
    from: () => ({ where: () => ({ limit: async () => rows, then: promise.then.bind(promise) }) }),
  }
}
const tx = {
  delete: vi.fn((table) => ({
    where: vi.fn(() =>
      table === tables.document
        ? { returning: async () => targets.map(({ id }) => ({ id })) }
        : Promise.resolve(undefined)
    ),
  })),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.select
    .mockReset()
    .mockReturnValueOnce(selection([targets[0]]))
    .mockReturnValueOnce(selection([]))
    .mockReturnValue(selection([{ userId: 'owner', workspaceId: 'workspace-1' }]))
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) =>
    callback(tx)
  )
  mocks.queuedDelete.mockReturnValue({ where: async () => undefined })
  mocks.cleanup.mockReset().mockResolvedValue({
    deleted: [],
    retained: [
      {
        fileUrl: firstUrl,
        reason:
          'File deletion is unavailable without current canonical ownership and delete permission',
      },
    ],
  })
  mocks.decrement.mockResolvedValue(undefined)
})

describe('knowledge document deletion cleanup reporting', () => {
  it('reports retained storage and does not decrement usage for an unproved persisted URL', async () => {
    const { deleteDocument } = await import('./service')
    const result = await deleteDocument('doc-1', 'request')
    expect(result.success).toBe(true)
    expect(result.message).toContain('retained')
    expect(result.storageCleanup).toEqual({
      deleted: [],
      retained: [{ fileUrl: firstUrl, reason: expect.any(String) }],
    })
    expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith([firstUrl])
    expect(mocks.decrement).not.toHaveBeenCalled()
    expect(mocks.queuedDelete).toHaveBeenCalled()
  })

  it('decrements storage only after actual reported physical deletion', async () => {
    mocks.cleanup.mockResolvedValueOnce({ deleted: [firstUrl], retained: [] })
    const { deleteDocument } = await import('./service')
    const result = await deleteDocument('doc-1', 'request')
    expect(result.storageCleanup).toEqual({ deleted: [firstUrl], retained: [] })
    expect(mocks.decrement).toHaveBeenCalledExactlyOnceWith('owner', 3, 'workspace-1')
  })

  it('preserves the bulk array result and reports partial storage retention without claiming it deleted', async () => {
    mocks.select
      .mockReset()
      .mockReturnValueOnce(selection(targets))
      .mockReturnValueOnce(selection([]))
      .mockReturnValue(selection([{ userId: 'owner', workspaceId: 'workspace-1' }]))
    mocks.cleanup.mockResolvedValueOnce({
      deleted: [firstUrl],
      retained: [{ fileUrl: secondUrl, reason: 'Storage deletion failed; file retained' }],
    })
    const { bulkDocumentOperation } = await import('./service')
    const result = await bulkDocumentOperation('kb-1', 'delete', ['doc-1', 'doc-2'], 'request')
    expect(result.successCount).toBe(2)
    expect(result.updatedDocuments).toEqual([
      { id: 'doc-1', deletedAt: expect.any(Date) },
      { id: 'doc-2', deletedAt: expect.any(Date) },
    ])
    expect(result.storageCleanup).toEqual({
      deleted: [firstUrl],
      retained: [{ fileUrl: secondUrl, reason: expect.any(String) }],
    })
    expect(mocks.decrement).toHaveBeenCalledExactlyOnceWith('owner', 3, 'workspace-1')
  })

  it('preserves a still-referenced object and its accounted storage', async () => {
    mocks.select
      .mockReset()
      .mockReturnValueOnce(selection([targets[0]]))
      .mockReturnValueOnce(selection([{ fileUrl: firstUrl }]))
    mocks.cleanup.mockResolvedValueOnce({ deleted: [], retained: [] })
    const { deleteDocument } = await import('./service')
    const result = await deleteDocument('doc-1', 'request')
    expect(result.storageCleanup).toEqual({ deleted: [], retained: [] })
    expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith([])
    expect(mocks.decrement).not.toHaveBeenCalled()
  })
})

describe('queued document source authorization before mutation and contact', () => {
  const data = {
    filename: 'owned.txt',
    fileUrl: 'https://public.example/owned.txt',
    fileSize: 5,
    mimeType: 'text/plain',
  }
  const options = { chunkSize: 1000, chunkOverlap: 200, minCharactersPerChunk: 1 }
  const scope = { actorUserId: 'actor', workspaceId: 'workspace-1' }
  const allowed = {
    hasAccess: true,
    knowledgeBase: { id: 'kb-1', workspaceId: 'workspace-1', embeddingModel: 'fixture' },
  }
  let update: ReturnType<typeof vi.fn>
  beforeEach(() => {
    mocks.access.mockReset().mockResolvedValue(allowed)
    mocks.select.mockReset().mockReturnValue(selection([{ id: 'doc-1' }]))
    update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }))
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        update,
        select: () => ({
          from: () => ({
            where: () => ({ for: () => ({ limit: async () => [{ id: 'doc-1' }] }) }),
          }),
        }),
      })
    )
    mocks.process.mockReset().mockImplementation(async (_url, _filename, _type, source) => {
      await source.reauthorize()
      return { chunks: [], metadata: { chunkCount: 0, tokenCount: 0, characterCount: 0 } }
    })
  })
  it('carries actual actor, document/KB/workspace and signal into the authorized parser path', async () => {
    const { processDocumentAsync } = await import('./service')
    await processDocumentAsync('kb-1', 'doc-1', data, options, scope)
    expect(mocks.access).toHaveBeenCalledWith('kb-1', 'actor')
    expect(mocks.process).toHaveBeenCalledWith(
      data.fileUrl,
      data.filename,
      data.mimeType,
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        filename: data.filename,
        signal: expect.any(AbortSignal),
        reauthorize: expect.any(Function),
      }),
      1000,
      200,
      1
    )
    expect(update).toHaveBeenCalledTimes(2)
  })
  it.each(['actor', 'workspace', 'KB', 'document', 'encoded-archive'])(
    'rejects %s before prepare/reset/parser or failure-state mutation',
    async (kind) => {
      const { processDocumentAsync } = await import('./service')
      if (kind === 'KB') mocks.access.mockResolvedValue({ hasAccess: false, notFound: true })
      if (kind === 'document') mocks.select.mockReturnValue(selection([]))
      await expect(
        processDocumentAsync(
          'kb-1',
          'doc-1',
          kind === 'encoded-archive'
            ? { ...data, fileUrl: 'https://public.example/workflow%2Darchive/data' }
            : data,
          options,
          {
            ...scope,
            ...(kind === 'actor' ? { actorUserId: '' } : {}),
            ...(kind === 'workspace' ? { workspaceId: 'wrong' } : {}),
          }
        )
      ).rejects.toMatchObject({ status: 403 })
      expect(mocks.process).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
    }
  )
  it('rechecks revoked permission at source handoff and does not mark an unauthorized row failed', async () => {
    const { processDocumentAsync } = await import('./service')
    mocks.access.mockResolvedValueOnce(allowed).mockResolvedValue({ hasAccess: false })
    await expect(processDocumentAsync('kb-1', 'doc-1', data, options, scope)).rejects.toMatchObject(
      { status: 403 }
    )
    expect(update).toHaveBeenCalledTimes(1)
    expect(mocks.process).toHaveBeenCalledOnce()
  })
})
