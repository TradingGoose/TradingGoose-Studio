/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  insert: vi.fn(),
  copy: vi.fn(),
  rawCleanup: vi.fn(),
  permission: vi.fn(),
  quota: vi.fn(),
  usage: vi.fn(),
  enqueue: vi.fn(),
  refresh: vi.fn(),
  rollbackFirst: vi.fn(),
  rollbackSecond: vi.fn(),
  uuid: vi.fn(),
  loggerError: vi.fn(),
}))
const tables = {
  knowledgeBase: { id: 'kb.id', deletedAt: 'kb.deletedAt' },
  document: { knowledgeBaseId: 'doc.kb', deletedAt: 'doc.deletedAt' },
  embedding: { documentId: 'embedding.doc' },
  knowledgeBaseTagDefinitions: { knowledgeBaseId: 'tag.kb' },
}
vi.mock('crypto', () => ({ randomUUID: mocks.uuid }))
vi.mock('@tradinggoose/db', () => ({
  db: { select: mocks.select, transaction: mocks.transaction },
}))
vi.mock('@tradinggoose/db/schema', () => tables)
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  count: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: mocks.quota,
  incrementStorageUsage: mocks.usage,
}))
vi.mock('@/lib/copilot/review-sessions/types', () => ({
  ENTITY_KIND_KNOWLEDGE_BASE: 'knowledge_base',
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  enqueueDocumentProcessingJobs: mocks.enqueue,
}))
vi.mock('@/lib/knowledge/documents/storage', () => ({
  copyKnowledgeDocumentFile: mocks.copy,
  deleteKnowledgeDocumentFiles: mocks.rawCleanup,
}))
vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(),
  getUserEntityPermissions: mocks.permission,
}))
vi.mock('@/lib/yjs/server/apply-entity-state', () => ({ applySavedEntityState: vi.fn() }))
vi.mock('@/lib/yjs/server/entity-loaders', () => ({ lockSavedEntityList: vi.fn() }))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({ refreshEntityListSession: mocks.refresh }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: mocks.loggerError }),
}))

const sourceBase = {
  id: 'kb-source',
  name: 'Source',
  description: 'Description',
  workspaceId: 'workspace-source',
  tokenCount: 4,
  embeddingModel: 'openai/text-embedding-3-small',
  embeddingDimension: 1536,
  chunkingConfig: { maxSize: 100, minSize: 10, overlap: 5 },
}
const sourceDocs = [
  {
    id: 'doc-1',
    filename: 'first.pdf',
    fileUrl: '/api/files/serve/source-first?context=knowledge-base',
    fileSize: 3,
    mimeType: 'application/pdf',
    processingStatus: 'pending',
    enabled: true,
  },
  {
    id: 'doc-2',
    filename: 'second.pdf',
    fileUrl: '/api/files/serve/source-second?context=knowledge-base',
    fileSize: 4,
    mimeType: 'application/pdf',
    processingStatus: 'completed',
    enabled: true,
    chunkCount: 1,
    tokenCount: 4,
    characterCount: 10,
  },
]
const firstUrl = '/api/files/serve/target-first?context=knowledge-base'
const secondUrl = '/api/files/serve/target-second?context=knowledge-base'
function selection(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
        then: Promise.resolve(rows).then.bind(Promise.resolve(rows)),
      }),
    }),
  }
}
let inserted: Array<{ table: unknown; rows: unknown }>
const tx = { insert: mocks.insert, select: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  inserted = []
  mocks.uuid.mockReset().mockReturnValueOnce('kb-copy').mockReturnValue('new-document')
  mocks.permission.mockResolvedValue('write')
  mocks.quota.mockResolvedValue({ allowed: true })
  mocks.select
    .mockReset()
    .mockReturnValueOnce(selection([sourceBase]))
    .mockReturnValueOnce(selection(sourceDocs))
  mocks.insert.mockImplementation((table) => ({
    values: async (rows: unknown) => {
      inserted.push({ table, rows })
    },
  }))
  tx.select.mockReturnValue(selection([]))
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) =>
    callback(tx)
  )
  mocks.rollbackFirst.mockReset().mockResolvedValue(undefined)
  mocks.rollbackSecond.mockReset().mockResolvedValue(undefined)
  mocks.copy
    .mockReset()
    .mockResolvedValueOnce({ fileUrl: firstUrl, rollback: mocks.rollbackFirst })
    .mockResolvedValueOnce({ fileUrl: secondUrl, rollback: mocks.rollbackSecond })
  mocks.rawCleanup.mockImplementation(() => {
    throw new Error('Raw URLs cannot authorize copy rollback')
  })
  mocks.usage.mockResolvedValue(undefined)
  mocks.enqueue.mockResolvedValue(undefined)
  mocks.refresh.mockResolvedValue(undefined)
})

describe('knowledge base copy rollback ownership', () => {
  it('persists only copy URLs and leaves rollback closures inside the precommit scope', async () => {
    const { copyKnowledgeBaseToWorkspace } = await import('./service')
    const copied = await copyKnowledgeBaseToWorkspace(
      'kb-source',
      'workspace-target',
      'actor',
      'request'
    )
    const docs = inserted.find((entry) => entry.table === tables.document)?.rows
    expect(docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileUrl: firstUrl }),
        expect.objectContaining({ fileUrl: secondUrl }),
      ])
    )
    for (const doc of docs as Array<Record<string, unknown>>)
      expect(doc).not.toHaveProperty('rollback')
    expect(copied).toMatchObject({ id: 'kb-copy', name: 'Source (Copy)', docCount: 2 })
    expect(copied).not.toHaveProperty('rollback')
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ docData: expect.objectContaining({ fileUrl: firstUrl }) }),
      ]),
      'request',
      'actor'
    )
    expect(mocks.usage).toHaveBeenCalledWith('actor', 7, 'workspace-target')
    expect(mocks.rollbackFirst).not.toHaveBeenCalled()
    expect(mocks.rollbackSecond).not.toHaveBeenCalled()
    expect(mocks.rawCleanup).not.toHaveBeenCalled()
  })

  it('rolls back only completed server copies when a later source copy refuses', async () => {
    mocks.copy
      .mockReset()
      .mockResolvedValueOnce({ fileUrl: firstUrl, rollback: mocks.rollbackFirst })
      .mockRejectedValueOnce(new Error('Private source refused'))
    const { copyKnowledgeBaseToWorkspace } = await import('./service')
    await expect(
      copyKnowledgeBaseToWorkspace('kb-source', 'workspace-target', 'actor', 'request')
    ).rejects.toThrow('Private source refused')
    expect(mocks.rollbackFirst).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.rollbackSecond).not.toHaveBeenCalled()
    expect(mocks.rawCleanup).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.usage).not.toHaveBeenCalled()
  })

  it('invokes every exact-copy rollback on DB failure and preserves the original failure', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('Database copy failed'))
    mocks.rollbackFirst.mockRejectedValueOnce(new Error('Rollback refused; object preserved'))
    const { copyKnowledgeBaseToWorkspace } = await import('./service')
    await expect(
      copyKnowledgeBaseToWorkspace('kb-source', 'workspace-target', 'actor', 'request')
    ).rejects.toThrow('Database copy failed')
    expect(mocks.rollbackFirst).toHaveBeenCalledOnce()
    expect(mocks.rollbackSecond).toHaveBeenCalledOnce()
    expect(mocks.loggerError).toHaveBeenCalled()
    expect(mocks.rawCleanup).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.usage).not.toHaveBeenCalled()
  })

  it('retains permission and storage quota gates before any copy contact', async () => {
    mocks.permission.mockResolvedValueOnce('read')
    const { copyKnowledgeBaseToWorkspace } = await import('./service')
    await expect(
      copyKnowledgeBaseToWorkspace('kb-source', 'workspace-target', 'actor', 'request')
    ).rejects.toThrow('permission')
    expect(mocks.copy).not.toHaveBeenCalled()
    mocks.quota.mockResolvedValueOnce({ allowed: false, error: 'Storage limit exceeded' })
    await expect(
      copyKnowledgeBaseToWorkspace('kb-source', 'workspace-target', 'actor', 'request')
    ).rejects.toThrow('Storage limit exceeded')
    expect(mocks.copy).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
