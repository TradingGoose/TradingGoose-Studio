import { db } from '@tradinggoose/db'
import { document, embedding, pendingExecution, systemSettings } from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, it, vi } from 'vitest'
import { TriggerExecutionBusyError, upsertSystemSettings } from '@/lib/system-settings/service'
import {
  failDocumentAttempt,
  recoverInterruptedLocalDocuments,
  reserveDocumentRetry,
  writeDocumentAttempt,
} from './claim'

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@tradinggoose/db', () => ({ db: { transaction } }))

const selection = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  for: vi.fn(),
}
const mutation = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
}
const tx = { select: () => selection, update: vi.fn(() => mutation), delete: vi.fn(() => mutation) }
const payload = {
  documentId: 'doc',
  knowledgeBaseId: 'kb',
  workspaceId: 'space',
  userId: 'actor',
  requestId: 'request',
  docData: { filename: 'doc.txt', fileUrl: '/doc.txt', fileSize: 4, mimeType: 'text/plain' },
  processingOptions: { chunkSize: 512, minCharactersPerChunk: 24, chunkOverlap: 100 },
}
const id = 'document_processing:doc:request'
const marker = { id, payload, workspaceId: payload.workspaceId, userId: payload.userId }
const doc = { id: payload.documentId, processingStatus: 'processing' }
const dialect = new PgDialect()
beforeEach(() => {
  vi.clearAllMocks()
  selection.for.mockReset().mockResolvedValue([])
  mutation.returning.mockReset().mockResolvedValue([{ id }])
  transaction.mockReset().mockImplementation((write) => write(tx))
})

it.each([
  ['local', 'nonce'],
  ['trigger', undefined],
] as const)(
  'requires the %s owner and retires it after its final write',
  async (_mode, localDocumentNonce) => {
    selection.for.mockResolvedValueOnce([marker]).mockResolvedValueOnce([doc])
    const write = vi.fn(async () => {
      expect(tx.delete).not.toHaveBeenCalled()
    })
    await expect(
      writeDocumentAttempt({ id, localDocumentNonce }, payload, 'complete', write)
    ).resolves.toBe(true)
    const owner = dialect.sqlToQuery(selection.where.mock.calls[0][0] as SQL)
    expect(owner.sql).toContain('"pending_execution"."id" = $4')
    expect(owner.params).toContain(id)
    expect(owner.params).toContain('local')
    if (localDocumentNonce) {
      expect(owner.params).toContain(localDocumentNonce)
      expect(owner.sql).toContain("->>'localDocumentNonce' = $6")
      expect(owner.sql).toContain("interval '90 seconds'")
    } else {
      expect(owner.sql).toContain('<>')
    }
    expect(selection.for.mock.calls).toEqual([['update'], ['update']])
    expect(write).toHaveBeenCalledExactlyOnceWith(tx, doc)
    expect(tx.delete).toHaveBeenCalledExactlyOnceWith(pendingExecution)
  }
)

it('recovers only expired local claims for the requested document and skips locked owners', async () => {
  selection.for.mockResolvedValueOnce([marker]).mockResolvedValueOnce([doc])
  await expect(recoverInterruptedLocalDocuments('kb', 'doc')).resolves.toBe(1)
  const scope = dialect.sqlToQuery(selection.where.mock.calls[0][0])
  expect(scope.params).toEqual([
    'document',
    'processing',
    'document_processing',
    'local',
    'kb',
    'doc',
  ])
  expect(scope.sql).toMatch(/updated_at" <= .*interval '90 seconds'/s)
  expect(selection.for).toHaveBeenCalledWith('update', { skipLocked: true })
  expect(tx.update).toHaveBeenCalledExactlyOnceWith(document)
  expect(mutation.set).toHaveBeenCalledWith(expect.objectContaining({ processingStatus: 'failed' }))
  expect(tx.delete.mock.calls).toEqual([[embedding], [pendingExecution]])
  await expect(recoverInterruptedLocalDocuments('kb', 'doc')).resolves.toBe(0)
})

it('waits for interrupted document cleanup to commit before other work blocks a mode switch', async () => {
  const owners = new Set([id, 'unrelated-work'])
  const partialVectors = new Set([doc.id])
  let status = doc.processingStatus
  let release!: () => void
  const commit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const lockMode = vi.fn()
  selection.for.mockResolvedValueOnce([marker]).mockResolvedValueOnce([doc])
  transaction
    .mockImplementationOnce(async (run) => {
      const recovered = await run(tx)
      expect(recovered).toBe(1)
      expect(tx.update).toHaveBeenCalledExactlyOnceWith(document)
      expect(tx.delete.mock.calls).toEqual([[embedding], [pendingExecution]])
      const ids = mutation.where.mock.calls.map(([scope]) => dialect.sqlToQuery(scope).params[0])
      expect(ids).toEqual([doc.id, doc.id, id])
      await commit()
      status = mutation.set.mock.calls[0][0].processingStatus
      partialVectors.delete(String(ids[1]))
      owners.delete(String(ids[2]))
      return recovered
    })
    .mockImplementationOnce((run) =>
      run({
        execute: lockMode,
        select: () => ({
          from: (table: unknown) => {
            if (table === systemSettings) return { where: () => ({ limit: () => [] }) }
            expect(table).toBe(pendingExecution)
            expect([...owners]).toEqual(['unrelated-work'])
            return { limit: () => [...owners].map((id) => ({ id })) }
          },
        }),
      })
    )

  const outcome = upsertSystemSettings({ triggerDevEnabled: true }).catch((error) => error)
  await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce())
  expect(transaction).toHaveBeenCalledOnce()
  expect(lockMode).not.toHaveBeenCalled()
  expect([status, [...partialVectors], [...owners]]).toEqual([
    'processing',
    ['doc'],
    [id, 'unrelated-work'],
  ])
  release()
  await expect(outcome).resolves.toBeInstanceOf(TriggerExecutionBusyError)
  expect(lockMode).toHaveBeenCalledOnce()
  expect([status, [...partialVectors], [...owners]]).toEqual(['failed', [], ['unrelated-work']])
})

it.each(['completed', 'wrong owner'])(
  'keeps document data when retiring a %s attempt',
  async (kind) => {
    selection.for.mockResolvedValueOnce([
      kind === 'completed' ? marker : { ...marker, userId: 'another-user' },
    ])
    if (kind === 'completed')
      selection.for.mockResolvedValueOnce([{ ...doc, processingStatus: 'completed' }])
    await expect(failDocumentAttempt({ id }, 'late failure')).resolves.toBe(true)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.delete).toHaveBeenCalledExactlyOnceWith(pendingExecution)
  }
)

it.each([
  ['local', 'first-nonce'],
  ['trigger', undefined],
] as const)(
  'rolls back failed %s retirement and fences the predecessor after Retry',
  async (_mode, nonce) => {
    const first = {
      ...marker,
      executionType: 'document',
      source: 'document_processing',
      status: 'processing' as const,
      billingScopeId: payload.userId,
      billingScopeType: nonce ? 'local' : 'user',
      payload: { ...payload, localDocumentNonce: nonce as string | undefined },
    }
    const next = {
      ...first,
      id: 'document_processing:doc:retry',
      payload: { ...payload, requestId: 'retry', localDocumentNonce: nonce && 'second-nonce' },
    }
    const initial = { status: 'processing', vectors: ['partial'], owner: first }
    let visible: { status: string; vectors: string[]; owner: typeof first | null } =
      structuredClone(initial)
    let release!: (allow: boolean) => void
    const retire = vi.fn(async (_draft: typeof visible) => true)
    const holdRetirement = () =>
      new Promise<boolean>((resolve) => {
        release = resolve
      })
    retire.mockImplementationOnce(holdRetirement)

    // Each callback sees committed rows. Its staged writes become visible together on success.
    transaction.mockImplementation(async (run) => {
      const draft = structuredClone(visible)
      const result = await run({
        select: () => ({
          from: (table: unknown) => ({
            where: (scope: SQL) => ({
              for: (lock: string) => {
                expect(lock).toBe('update')
                if (table === document) return [{ ...doc, processingStatus: draft.status }]
                expect(table).toBe(pendingExecution)
                const { params } = dialect.sqlToQuery(scope)
                const owner = draft.owner
                return owner &&
                  params.includes(owner.id) &&
                  (!owner.payload.localDocumentNonce ||
                    params.includes(owner.payload.localDocumentNonce))
                  ? [owner]
                  : []
              },
            }),
          }),
        }),
        update: (table: unknown) => ({
          set: ({ processingStatus }: { processingStatus: string }) => ({
            where: (scope: SQL) => {
              expect(table).toBe(document)
              const query = dialect.sqlToQuery(scope)
              if (processingStatus === 'failed') {
                expect(query.params).toEqual([doc.id])
                draft.status = processingStatus
                return
              }
              expect(processingStatus).toBe('pending')
              expect(query.sql).toContain('not exists')
              expect(query.sql).toContain('"execution_type" = \'document\'')
              expect(query.params).toEqual([
                'doc',
                'kb',
                'failed',
                'pending',
                'processing',
                'kb',
                'doc',
              ])
              return {
                returning: () => {
                  if (draft.status !== 'failed' || draft.owner) return []
                  draft.status = processingStatus
                  return [{ id: doc.id }]
                },
              }
            },
          }),
        }),
        delete: (table: unknown) => ({
          where: (scope: SQL) => {
            const { params } = dialect.sqlToQuery(scope)
            if (table === embedding) {
              expect(params).toEqual([doc.id])
              draft.vectors = []
              return
            }
            expect(table).toBe(pendingExecution)
            expect(params).toEqual([draft.owner?.id])
            return {
              returning: async () => {
                if (!(await retire(structuredClone(draft)))) return []
                draft.owner = null
                return [{ id: params[0] }]
              },
            }
          },
        }),
        insert: (table: unknown) => ({
          values: (owner: typeof first) => {
            expect(table).toBe(pendingExecution)
            draft.owner = owner
          },
        }),
      })
      visible = draft
      return result
    })

    const predecessor = { id, localDocumentNonce: nonce }
    const cleanup = () => failDocumentAttempt(predecessor, 'interrupted')
    const retry = () => db.transaction((store) => reserveDocumentRetry(store, 'kb', doc.id))
    const rejected = expect(cleanup()).rejects.toThrow('Document attempt retirement failed')
    await vi.waitFor(() => expect(retire).toHaveBeenCalledOnce())
    expect(retire).toHaveBeenCalledWith({ status: 'failed', vectors: [], owner: first })
    expect(visible).toEqual(initial)
    await expect(retry()).resolves.toBe(false)
    release(false)
    await rejected
    expect(transaction.mock.settledResults[0]?.type).toBe('rejected')
    expect(visible).toEqual(initial)

    // A metadata edit can mark the document failed while its owner still holds the partial vectors.
    visible.status = 'failed'
    retire.mockImplementationOnce(holdRetirement)
    const cleaning = cleanup()
    await vi.waitFor(() => expect(retire).toHaveBeenCalledTimes(2))
    await expect(retry()).resolves.toBe(false)
    expect(visible).toEqual({ ...initial, status: 'failed' })
    release(true)
    await expect(cleaning).resolves.toBe(true)
    expect(visible).toEqual({ status: 'failed', vectors: [], owner: null })
    await db.transaction(async (store) => {
      expect(await reserveDocumentRetry(store, 'kb', doc.id)).toBe(true)
      await store.insert(pendingExecution).values(next)
    })
    expect(visible).toEqual({ status: 'pending', vectors: [], owner: next })
    visible.status = 'processing'
    visible.vectors.push('replacement')
    await expect(cleanup()).resolves.toBe(false)
    const write = vi.fn()
    for (const stage of ['prepare', 'batch', 'complete'] as const)
      await expect(writeDocumentAttempt(predecessor, payload, stage, write)).rejects.toThrow(
        'no longer active'
      )
    expect(write).not.toHaveBeenCalled()
    expect(visible).toEqual({ status: 'processing', vectors: ['replacement'], owner: next })
    await expect(
      writeDocumentAttempt(
        { id: next.id, localDocumentNonce: next.payload.localDocumentNonce },
        next.payload,
        'complete',
        write
      )
    ).resolves.toBe(true)
    expect(write).toHaveBeenCalledOnce()
  }
)
