// DOCUMENT_CLAIM_TEST_DATABASE_URL must point to a disposable, migrated PostgreSQL database.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { db } from '@tradinggoose/db'
import {
  document,
  embedding,
  knowledgeBase,
  pendingExecution,
  user,
  workspace,
} from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  failDocumentAttempt,
  recoverInterruptedLocalDocuments,
  reserveDocumentRetry,
  writeDocumentAttempt,
} from './claim'

const databaseUrl = process.env.DOCUMENT_CLAIM_TEST_DATABASE_URL
vi.mock('@tradinggoose/db', async () => {
  const schema = await import('@tradinggoose/db/schema')
  const url = process.env.DOCUMENT_CLAIM_TEST_DATABASE_URL
  if (!url) return { ...schema, db: {} }
  const { default: postgres } = await vi.importActual<typeof import('postgres')>('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  return { ...schema, db: drizzle(postgres(url, { max: 10 }), { schema }) }
})

vi.mock('@/lib/execution/background-execution', () => ({ dispatchBackgroundExecution: vi.fn() }))
vi.mock('@/lib/knowledge/documents/storage', () => ({
  copyKnowledgeDocumentFile: vi.fn(
    async () => '/api/files/serve/copied-file?context=knowledge-base'
  ),
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({ refreshEntityListSession: vi.fn() }))

describe.skipIf(!databaseUrl)('PostgreSQL document ownership', () => {
  const actor = randomUUID()
  const workspaceId = randomUUID()
  const kb = randomUUID()
  const file = {
    filename: 'claim.txt',
    fileUrl: 'https://example.test/claim',
    fileSize: 10,
    mimeType: 'text/plain',
  }
  beforeAll(async () => {
    await db.insert(user).values({
      id: actor,
      name: actor,
      email: `${actor}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db
      .insert(workspace)
      .values({ id: workspaceId, name: 'Lease test', ownerId: actor, billingOwnerUserId: actor })
    await db
      .insert(knowledgeBase)
      .values({ id: kb, workspaceId, userId: actor, name: 'Lease test' })
  })
  afterAll(async () => {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, kb))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, actor))
    await db.$client.end()
  })

  async function createDocument() {
    const id = randomUUID()
    await db
      .insert(document)
      .values({ id, knowledgeBaseId: kb, ...file, processingStatus: 'processing' })
    return id
  }

  function marker(documentId: string, nonce?: string) {
    const payload = {
      userId: actor,
      workspaceId,
      knowledgeBaseId: kb,
      documentId,
      docData: file,
      processingOptions: { chunkSize: 512, minCharactersPerChunk: 24, chunkOverlap: 100 },
      requestId: randomUUID(),
      localDocumentNonce: nonce,
    }
    return {
      id: `document_processing:${documentId}:${payload.requestId}`,
      payload,
      userId: actor,
      workspaceId,
      source: 'document_processing',
      billingScopeType: nonce ? 'local' : 'user',
      billingScopeId: actor,
      executionType: 'document',
      status: 'processing' as const,
      updatedAt: sql`clock_timestamp() at time zone 'UTC'`,
    }
  }

  function vector(documentId: string, content: string) {
    return {
      id: randomUUID(),
      documentId,
      knowledgeBaseId: kb,
      content,
      contentLength: content.length,
      tokenCount: 1,
      chunkHash: content,
      embedding: Array(1536).fill(0.1),
      chunkIndex: 0,
      startOffset: 0,
      endOffset: content.length,
    }
  }

  async function read(id: string) {
    return db
      .select({ status: document.processingStatus })
      .from(document)
      .where(eq(document.id, id))
  }

  it.each(['local', 'trigger'])(
    'rolls back all cleanup and fences late %s writers after Retry',
    async (mode) => {
      const doc = await createDocument()
      const localDocumentNonce = mode === 'local' ? randomUUID() : undefined
      const a = marker(doc, localDocumentNonce)
      const attempt = { id: a.id, localDocumentNonce }
      await db.insert(pendingExecution).values(a)
      await db.insert(embedding).values(vector(doc, 'predecessor'))

      // Block exact marker retirement after vector deletion, on an independent connection.
      const key = Math.floor(Math.random() * 1e9)
      const fn = sql.identifier(`test_retire_${key}`)
      const trigger = sql.identifier(`test_retire_trigger_${key}`)
      await db.execute(sql`create function ${fn}() returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock(${sql.raw(String(key))}); return old; end $$`)
      await db.execute(sql`create trigger ${trigger} before delete on ${pendingExecution}
      for each row when (old.id = ${sql.raw(`'${a.id}'`)}) execute function ${fn}()`)
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${key})`)
          const result = failDocumentAttempt(attempt, 'interrupted').catch((error) => error)
          let pid: number | undefined
          await vi.waitFor(async () => {
            const [blocked] = await tx.execute<{ pid: number }>(
              sql`select pid from pg_locks where locktype = 'advisory' and not granted and objid = ${key} limit 1`
            )
            pid = blocked?.pid
            expect(pid).toBeTruthy()
          })
          expect(await read(doc)).toEqual([{ status: 'processing' }])
          expect(
            await db.select().from(embedding).where(eq(embedding.documentId, doc))
          ).toHaveLength(1)
          expect(await db.transaction((tx) => reserveDocumentRetry(tx, kb, doc))).toBe(false)
          await tx.execute(sql`select pg_terminate_backend(${pid})`)
          expect(await result).toBeInstanceOf(Error)
        })
      } finally {
        await db.execute(sql`drop trigger ${trigger} on ${pendingExecution}`)
        await db.execute(sql`drop function ${fn}()`)
      }
      expect(await read(doc)).toEqual([{ status: 'processing' }])
      expect(await db.select().from(embedding).where(eq(embedding.documentId, doc))).toHaveLength(1)
      // An authorized metadata edit alone cannot admit Retry.
      await db.update(document).set({ processingStatus: 'failed' }).where(eq(document.id, doc))
      expect(await db.transaction((tx) => reserveDocumentRetry(tx, kb, doc))).toBe(false)
      expect(await failDocumentAttempt(attempt, 'interrupted')).toBe(true)
      expect(await db.select().from(embedding).where(eq(embedding.documentId, doc))).toHaveLength(0)
      const b = marker(doc, localDocumentNonce && randomUUID())
      await db.transaction(async (tx) => {
        expect(await reserveDocumentRetry(tx, kb, doc)).toBe(true)
        await tx.insert(pendingExecution).values(b)
      })
      await db.update(document).set({ processingStatus: 'processing' }).where(eq(document.id, doc))
      await db.insert(embedding).values(vector(doc, 'replacement'))
      expect(await failDocumentAttempt(attempt, 'replay')).toBe(false)
      for (const stage of ['prepare', 'batch', 'complete'] as const) {
        const write = vi.fn()
        await expect(writeDocumentAttempt(attempt, a.payload, stage, write)).rejects.toThrow(
          'no longer active'
        )
        expect(write).not.toHaveBeenCalled()
      }
      expect(await read(doc)).toEqual([{ status: 'processing' }])
      expect(
        await db
          .select({ content: embedding.content })
          .from(embedding)
          .where(eq(embedding.documentId, doc))
      ).toEqual([{ content: 'replacement' }])
      expect(
        await db.select().from(pendingExecution).where(eq(pendingExecution.id, b.id))
      ).toHaveLength(1)
    }
  )

  it('recovers a real admission killed before the worker can load the processor', async () => {
    const doc = await createDocument()
    await db.update(document).set({ processingStatus: 'pending' }).where(eq(document.id, doc))
    const a = marker(doc)
    const child = spawn(
      'bun',
      [
        '--eval',
        `
      import {enqueuePendingExecution} from './lib/execution/pending-execution.ts'
      const row = JSON.parse(process.argv[1])
      await enqueuePendingExecution({...row,pendingExecutionId:row.id})
      process.stdout.write('admitted\\n')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60_000)
    `,
        JSON.stringify(a),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    const exited = once(child, 'exit')
    try {
      await vi.waitFor(
        async () =>
          expect(
            await db.select().from(pendingExecution).where(eq(pendingExecution.id, a.id))
          ).toHaveLength(1),
        { timeout: 10_000 }
      )
      child.kill('SIGKILL')
      await exited
      expect(await read(doc)).toEqual([{ status: 'pending' }])
      await db
        .update(pendingExecution)
        .set({ updatedAt: new Date(Date.now() - 91_000) })
        .where(eq(pendingExecution.id, a.id))
      expect(await recoverInterruptedLocalDocuments(kb, 'different-document')).toBe(0)
      expect(await recoverInterruptedLocalDocuments(kb, doc)).toBe(1)
      expect(await read(doc)).toEqual([{ status: 'failed' }])
      expect(
        await db.select().from(pendingExecution).where(eq(pendingExecution.id, a.id))
      ).toHaveLength(0)
    } finally {
      child.kill('SIGKILL')
      await exited
    }
  }, 15_000)

  it('admits a copied document, then gives competing Retry requests exactly one fresh owner', async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl)
    const { copyKnowledgeBaseToWorkspace } = await import('@/lib/knowledge/service')
    const { retryDocumentProcessing } = await import('./service')
    const { disarmLocalDocument } = await import('./local-heartbeat')
    const { dispatchBackgroundExecution } = await import('@/lib/execution/background-execution')
    const dispatch = vi.mocked(dispatchBackgroundExecution)
    dispatch.mockClear()
    const original = randomUUID()
    await db.insert(knowledgeBase).values({
      id: original,
      workspaceId,
      userId: actor,
      name: 'Copy fixture',
      chunkingConfig: { maxSize: 512, minSize: 24, overlap: 100 },
    })
    await db.insert(document).values({
      id: randomUUID(),
      knowledgeBaseId: original,
      ...file,
      fileSize: 0,
      processingStatus: 'pending',
    })
    let copiedId: string | undefined
    try {
      const copy = await copyKnowledgeBaseToWorkspace(original, workspaceId, actor, randomUUID())
      copiedId = copy.id
      const [doc] = await db.select().from(document).where(eq(document.knowledgeBaseId, copy.id))
      expect(doc.processingStatus).toBe('pending')
      const [queued, mode, nonce] = dispatch.mock.calls[0]
      if (!('pendingExecutionId' in queued) || !nonce)
        throw new Error('Missing local document dispatch')
      expect(mode).toBe('local')
      expect(
        await failDocumentAttempt(
          { id: queued.pendingExecutionId, localDocumentNonce: nonce },
          'fixture failure'
        )
      ).toBe(true)
      disarmLocalDocument(queued.pendingExecutionId, nonce)
      const newRequest = randomUUID()
      const retry = () => retryDocumentProcessing(copy.id, doc.id, doc, newRequest, actor)
      const results = await Promise.allSettled([retry(), retry()])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect(dispatch).toHaveBeenCalledTimes(2)
      const [newCall, , newNonce] = dispatch.mock.calls[1]
      if (!('pendingExecutionId' in newCall) || !newNonce) throw new Error('Missing Retry dispatch')
      expect(newCall.pendingExecutionId).toBe(`document_processing:${doc.id}:${newRequest}`)
      expect(newNonce).not.toBe(nonce)
      const [row] = await db
        .select()
        .from(pendingExecution)
        .where(eq(pendingExecution.id, newCall.pendingExecutionId))
      expect(row.payload).toMatchObject({
        knowledgeBaseId: copy.id,
        documentId: doc.id,
        userId: actor,
        workspaceId,
        requestId: newRequest,
        localDocumentNonce: newNonce,
      })
      expect(
        await failDocumentAttempt(
          { id: newCall.pendingExecutionId, localDocumentNonce: newNonce },
          'cleanup'
        )
      ).toBe(true)
    } finally {
      for (const [job, , nonce] of dispatch.mock.calls)
        if ('pendingExecutionId' in job && nonce) disarmLocalDocument(job.pendingExecutionId, nonce)
      if (copiedId) await db.delete(knowledgeBase).where(eq(knowledgeBase.id, copiedId))
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, original))
      vi.unstubAllEnvs()
    }
  }, 20_000)

  it('commits expired document cleanup even when unrelated queued work blocks a mode switch', async () => {
    const doc = await createDocument()
    const a = marker(doc, randomUUID())
    const other = marker(await createDocument())
    await db.insert(pendingExecution).values([
      { ...a, updatedAt: new Date(Date.now() - 91_000) },
      { ...other, executionType: 'workflow', source: 'workflow_api' },
    ])
    await db.insert(embedding).values(vector(doc, 'interrupted'))
    const { upsertSystemSettings, TriggerExecutionBusyError } = await import(
      '@/lib/system-settings/service'
    )
    await expect(upsertSystemSettings({ triggerDevEnabled: true })).rejects.toBeInstanceOf(
      TriggerExecutionBusyError
    )
    expect(await read(doc)).toEqual([{ status: 'failed' }])
    expect(await db.select().from(embedding).where(eq(embedding.documentId, doc))).toHaveLength(0)
    expect(
      await db.select().from(pendingExecution).where(eq(pendingExecution.id, a.id))
    ).toHaveLength(0)
    expect(
      await db.select().from(pendingExecution).where(eq(pendingExecution.id, other.id))
    ).toHaveLength(1)
  })

  it('fences the original Bun process when it resumes after expiry and Retry', async () => {
    const doc = await createDocument()
    const a = marker(doc, randomUUID())
    await db.insert(pendingExecution).values(a)
    const child = spawn(
      'bun',
      [
        '--eval',
        `
      import {writeDocumentAttempt,failDocumentAttempt} from './lib/knowledge/documents/claim.ts'
      import {once} from 'node:events'
      const row = JSON.parse(process.argv[1])
      const input=once(process.stdin,'data')
      process.stdout.write('ready\\n')
      await input
      const attempt={id:row.id,localDocumentNonce:row.payload.localDocumentNonce}
      const outcomes=await Promise.allSettled(['prepare','batch','complete'].map(stage=>writeDocumentAttempt(attempt,row.payload,stage,async()=>{throw new Error('stale writer reached mutation')})))
      const retired=await failDocumentAttempt(attempt,'stale')
      process.stdout.write(JSON.stringify([outcomes.map(result=>result.reason?.message),retired])+'\\n')
      process.exit(0)
    `,
        JSON.stringify(a),
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const exited = once(child, 'exit')
    try {
      await once(child.stdout, 'data')
      child.kill('SIGSTOP')
      await db
        .update(pendingExecution)
        .set({ updatedAt: new Date(Date.now() - 91_000) })
        .where(eq(pendingExecution.id, a.id))
      expect(await recoverInterruptedLocalDocuments(kb, doc)).toBe(1)
      const b = marker(doc, randomUUID())
      await db.transaction(async (tx) => {
        expect(await reserveDocumentRetry(tx, kb, doc)).toBe(true)
        await tx.insert(pendingExecution).values(b)
      })
      await db.update(document).set({ processingStatus: 'processing' }).where(eq(document.id, doc))
      await db.insert(embedding).values(vector(doc, 'replacement'))
      const answer = once(child.stdout, 'data')
      child.kill('SIGCONT')
      child.stdin.end('resume')
      expect(JSON.parse(String((await answer)[0]))).toEqual([
        Array(3).fill('Document processing attempt is no longer active'),
        false,
      ])
      expect(await read(doc)).toEqual([{ status: 'processing' }])
      expect(
        await db
          .select({ content: embedding.content })
          .from(embedding)
          .where(eq(embedding.documentId, doc))
      ).toEqual([{ content: 'replacement' }])
    } finally {
      child.kill('SIGKILL')
      await exited
    }
  })

  it('preserves completed vectors and rejects malformed attempts as mutation authority', async () => {
    const doc = await createDocument()
    const a = marker(doc)
    await db.update(document).set({ processingStatus: 'completed' }).where(eq(document.id, doc))
    await db.insert(embedding).values(vector(doc, 'completed'))
    await db.insert(pendingExecution).values(a)
    expect(await failDocumentAttempt({ id: a.id }, 'late cancellation')).toBe(true)
    expect(await read(doc)).toEqual([{ status: 'completed' }])
    const b = marker(doc)
    await db.update(document).set({ processingStatus: 'processing' }).where(eq(document.id, doc))
    await db
      .insert(pendingExecution)
      .values({ ...b, payload: { ...b.payload, requestId: 'someone-else' } })
    expect(await failDocumentAttempt({ id: b.id }, 'invalid payload')).toBe(true)
    expect(await read(doc)).toEqual([{ status: 'processing' }])
    expect(
      await db
        .select({ content: embedding.content })
        .from(embedding)
        .where(eq(embedding.documentId, doc))
    ).toEqual([{ content: 'completed' }])
  })

  it('keeps a CPU-blocked Bun process alive across the lease, then recovers after SIGKILL', async () => {
    const doc = await createDocument()
    const a = marker(doc)
    const lockedDoc = await createDocument()
    const locked = marker(lockedDoc)
    const child = spawn(
      'bun',
      [
        '--eval',
        `
      import {armLocalDocument} from './lib/knowledge/documents/local-heartbeat.ts'
      const owners = await Promise.all(process.argv.slice(1).map(armLocalDocument))
      process.stdout.write(JSON.stringify(owners)+'\\n')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,180000)
    `,
        a.id,
        locked.id,
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const exited = once(child, 'exit')
    try {
      const [data] = await Promise.race([
        once(child.stdout, 'data'),
        exited.then(() => {
          throw new Error('Lease owner exited before admission')
        }),
      ])
      const [localDocumentNonce, lockedNonce]: string[] = JSON.parse(String(data))
      expect(localDocumentNonce).toMatch(/^[\da-f-]{36}$/)
      await db
        .insert(pendingExecution)
        .values({ ...a, billingScopeType: 'local', payload: { ...a.payload, localDocumentNonce } })
      await db.insert(embedding).values(vector(doc, 'in-progress'))
      await db.insert(pendingExecution).values({
        ...locked,
        billingScopeType: 'local',
        payload: { ...locked.payload, localDocumentNonce: lockedNonce },
      })
      const started = Date.now()
      await writeDocumentAttempt(
        { id: locked.id, localDocumentNonce: lockedNonce },
        locked.payload,
        'batch',
        async (tx) => {
          await tx.insert(embedding).values(vector(lockedDoc, 'locked batch'))
          await new Promise((resolve) => setTimeout(resolve, 94_000))
          const [live] = await db
            .select()
            .from(pendingExecution)
            .where(eq(pendingExecution.id, a.id))
          expect(live.updatedAt.getTime()).toBeGreaterThan(started + 59_000)
          expect(await recoverInterruptedLocalDocuments(kb, doc)).toBe(0)
          expect(await recoverInterruptedLocalDocuments(kb, lockedDoc)).toBe(0)
        }
      )
      const [released] = await db
        .select()
        .from(pendingExecution)
        .where(eq(pendingExecution.id, locked.id))
      expect(released.updatedAt.getTime()).toBeGreaterThan(started + 90_000)
      child.kill('SIGKILL')
      await exited
      // Advance the DB lease clock for the dead owner while retaining its durable state.
      await db
        .update(pendingExecution)
        .set({ updatedAt: new Date(Date.now() - 91_000) })
        .where(eq(pendingExecution.id, a.id))
      expect(await recoverInterruptedLocalDocuments(kb, doc)).toBe(1)
      expect(await read(doc)).toEqual([{ status: 'failed' }])
      expect(await db.select().from(embedding).where(eq(embedding.documentId, doc))).toHaveLength(0)
      expect(await failDocumentAttempt({ id: a.id, localDocumentNonce }, 'stale callback')).toBe(
        false
      )
    } finally {
      child.kill('SIGKILL')
      await exited
    }
  }, 120_000)
})
