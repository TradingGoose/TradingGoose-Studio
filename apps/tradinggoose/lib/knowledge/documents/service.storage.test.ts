/** @vitest-environment node */
// Source regression: requires explicit fresh-owned canonical setup and scoped role; no common data.
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import * as tables from '@tradinggoose/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { assertStorageReadAccess } from '@/lib/uploads/source-read-boundary'
import type { KnowledgeDocumentSourceContext } from './storage'

const seams = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string } },
  files: new Map<string, Buffer>(),
  uploaded: vi.fn(),
  downloaded: vi.fn(),
  process: vi.fn(),
  embed: vi.fn(),
  jobStages: [] as string[],
}))
// Non-document branches are outside this fixture and fail if actually invoked.
vi.mock('@/lib/workflows/human-in-the-loop/service', () => ({
  reconcileWorkflowCheckpointChildren: () => {
    throw new Error('Unexpected workflow branch')
  },
}))
vi.mock('@/background/monitor-execution', () => ({
  executeMonitorJob: () => {
    throw new Error('Unexpected monitor branch')
  },
  isMonitorExecutionPayload: () => false,
}))
vi.mock('@/background/schedule-execution', () => ({
  executeScheduleJob: () => {
    throw new Error('Unexpected schedule branch')
  },
  isScheduleExecutionPayload: () => false,
}))
vi.mock('@/background/webhook-execution', () => ({
  executeWebhookJob: () => {
    throw new Error('Unexpected webhook branch')
  },
  isWebhookExecutionPayload: () => false,
}))
vi.mock('@/background/workflow-execution', () => ({
  executeWorkflowJob: () => {
    throw new Error('Unexpected workflow branch')
  },
  isWorkflowExecutionPayload: () => false,
}))
vi.mock('@/lib/auth', () => ({ getSession: async () => seams.session }))
vi.mock('@/lib/uploads/core/setup.server', () => ({}))
vi.mock('@/lib/uploads/core/setup', async (original) => ({
  ...(await original<typeof import('@/lib/uploads/core/setup')>()),
  getStorageProvider: () => 's3',
}))
vi.mock('@/lib/uploads/core/config-resolver', async (original) => ({
  ...(await original<typeof import('@/lib/uploads/core/config-resolver')>()),
  getStorageConfig: () => ({ bucket: 'synthetic-shared-fixture', region: 'fixture-region' }),
}))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'http://127.0.0.1:55440' }))
vi.mock('@/lib/uploads/core/storage-service', async (original) => ({
  ...(await original<typeof import('@/lib/uploads/core/storage-service')>()),
  hasCloudStorage: () => true,
  uploadFile: async (options: {
    customKey: string
    file: Buffer
    contentType: string
    context: string
  }) => {
    if (options.context !== 'knowledge-base') throw new Error('Unexpected upload context')
    const key = options.customKey
    seams.files.set(key, Buffer.from(options.file))
    seams.uploaded(key)
    return {
      key,
      name: key,
      path: `/api/files/serve/s3/${encodeURIComponent(key)}`,
      type: options.contentType,
      size: options.file.length,
    }
  },
  generatePresignedDownloadUrl: async (key: string, context: string) => {
    if (context !== 'knowledge-base') throw new Error('Unexpected presign context')
    return `http://127.0.0.1:55440/api/files/serve/s3/${encodeURIComponent(key)}?context=knowledge-base`
  },
  downloadFile: async (options: {
    key: string
    context: 'knowledge-base'
    signal?: AbortSignal
  }) => {
    assertStorageReadAccess(options.key, options.context)
    options.signal?.throwIfAborted()
    seams.downloaded(options.key)
    const bytes = seams.files.get(options.key)
    if (!bytes) throw new Error('Synthetic owned source is missing')
    return Buffer.from(bytes)
  },
}))
vi.mock('@/lib/knowledge/documents/document-processor', () => ({ processDocument: seams.process }))
vi.mock('@/lib/embeddings/utils', () => ({ generateEmbeddings: seams.embed }))

function freshSourceState() {
  const path = process.env.SOURCE_BILLING_TEST_STATE_FILE
  if (!path) return null
  const refuse = () => {
    throw new Error('Explicit fresh owned source-test state/loopback scoped-role binding required')
  }
  if (
    process.env.FIXTURE_MUTATION_OPT_IN !== 'r15-v1-fresh-disposable' ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    realpathSync(path) !== path ||
    basename(path) !== 'state.json' ||
    !/^db-private-[a-z0-9]+$/.test(basename(dirname(path)))
  )
    refuse()
  const st = lstatSync(path)
  const parent = lstatSync(dirname(path))
  const uid = process.getuid?.()
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.nlink !== 1 ||
    uid === undefined ||
    st.uid !== uid ||
    (st.mode & 0o777) !== 0o600 ||
    !parent.isDirectory() ||
    parent.uid !== uid ||
    (parent.mode & 0o777) !== 0o700 ||
    realpathSync(dirname(path)) !== dirname(path)
  )
    refuse()
  const bytes = readFileSync(path)
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    process.env.SOURCE_BILLING_TEST_STATE_SHA256
  )
    refuse()
  const original = JSON.parse(bytes.toString('utf8'))
  const input = new URL(process.env.DATABASE_URL ?? '')
  const operator = new URL(original.operator)
  const role = original.roles?.studio_app
  if (
    original.version !== 'r15-v1' ||
    original.stage !== 'ready' ||
    original.smoke ||
    original.statePath !== path ||
    !/^[a-f0-9]{16}$/.test(original.id) ||
    original.database !== `r15_${original.id}` ||
    !original.marker?.startsWith('r15-v1:') ||
    !['postgres:', 'postgresql:'].includes(input.protocol) ||
    input.protocol !== operator.protocol ||
    input.hostname !== '127.0.0.1' ||
    operator.hostname !== '127.0.0.1' ||
    !input.port ||
    input.port !== operator.port ||
    input.search ||
    input.hash ||
    input.pathname !== `/${original.database}` ||
    !role ||
    role.name !== `r15_${original.id}_studio_app` ||
    input.username !== role.name ||
    input.password !== role.password ||
    Object.keys(process.env).some((key) => key.startsWith('PG') && process.env[key])
  )
    refuse()
  return { database: original.database as string, marker: original.marker as string }
}
const originalState = freshSourceState()
const suite = originalState ? describe : describe.skip
let db: typeof import('@tradinggoose/db').db
const sourceBase = 'http://127.0.0.1:55440'
const options = { chunkSize: 1024, minCharactersPerChunk: 1, chunkOverlap: 200 }
const pendingIds = new Set<string>()
const releaseGates = new Set<() => void>()
const activeDirect = new Set<Promise<unknown>>()
let gate: Promise<void> | undefined
function holdProcessing() {
  let release!: () => void
  gate = new Promise<void>((resolve) => {
    release = resolve
  })
  releaseGates.add(release)
  return () => {
    releaseGates.delete(release)
    release()
  }
}
async function awaitPendingClosure() {
  const deadline = performance.now() + 5000
  while (pendingIds.size && performance.now() < deadline) {
    const rows = await db
      .select({ id: tables.pendingExecution.id })
      .from(tables.pendingExecution)
      .where(inArray(tables.pendingExecution.id, [...pendingIds]))
    if (!rows.length) {
      pendingIds.clear()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  if (pendingIds.size)
    throw new Error('Owned source-fixture pending jobs have not settled; pool must remain open')
}
async function person() {
  const id = `kb-source-${randomUUID()}`
  const now = new Date()
  await db.insert(tables.user).values({
    id,
    name: 'Synthetic KB source actor',
    email: `${id}@invalid.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(tables.userStats).values({ id: `${id}-stats`, userId: id })
  const { ensureDefaultUserSubscription } = await import('@/lib/billing/core/subscription')
  await ensureDefaultUserSubscription(id)
  return id
}
async function kbFixture() {
  const owner = await person()
  const actor = await person()
  const foreign = await person()
  const workspaceId = `kb-source-workspace-${randomUUID()}`
  const knowledgeBaseId = `kb-source-${randomUUID()}`
  const otherKnowledgeBaseId = `kb-other-${randomUUID()}`
  await db.insert(tables.workspace).values({
    id: workspaceId,
    name: 'Synthetic KB source scope',
    ownerId: owner,
    billingOwnerType: 'user',
    billingOwnerUserId: owner,
    billingOwnerOrganizationId: null,
  })
  await db.insert(tables.permissions).values({
    id: randomUUID(),
    entityType: 'workspace',
    entityId: workspaceId,
    userId: actor,
    permissionType: 'write',
  })
  await db.insert(tables.knowledgeBase).values([
    { id: knowledgeBaseId, userId: owner, workspaceId, name: 'Synthetic KB source' },
    { id: otherKnowledgeBaseId, userId: owner, workspaceId, name: 'Synthetic other KB' },
  ])
  return { owner, actor, foreign, workspaceId, knowledgeBaseId, otherKnowledgeBaseId }
}
async function retainedDocument(f: Awaited<ReturnType<typeof kbFixture>>) {
  const filename = 'retained.txt'
  const key = `${f.workspaceId}/${f.knowledgeBaseId}/${filename}`
  const data = {
    filename,
    fileUrl: `${sourceBase}/api/files/serve/s3/${encodeURIComponent(key)}?context=knowledge-base`,
    fileSize: 8,
    mimeType: 'text/plain',
  }
  const documentId = `kb-document-${randomUUID()}`
  await db.insert(tables.document).values({
    id: documentId,
    knowledgeBaseId: f.knowledgeBaseId,
    ...data,
    processingStatus: 'completed',
    chunkCount: 1,
    tokenCount: 1,
    characterCount: 8,
  })
  await db.insert(tables.embedding).values({
    id: randomUUID(),
    knowledgeBaseId: f.knowledgeBaseId,
    documentId,
    chunkIndex: 0,
    chunkHash: `fixture-${documentId}`,
    content: 'retained',
    contentLength: 8,
    tokenCount: 1,
    embedding: Array(1536).fill(0),
    embeddingModel: 'openai/text-embedding-3-small',
    startOffset: 0,
    endOffset: 8,
  })
  seams.files.set(key, Buffer.from('retained'))
  return { documentId, data }
}
async function retainedState(documentId: string) {
  return {
    document: await db.select().from(tables.document).where(eq(tables.document.id, documentId)),
    embeddings: await db
      .select()
      .from(tables.embedding)
      .where(eq(tables.embedding.documentId, documentId)),
  }
}
async function directProcessing(
  f: Awaited<ReturnType<typeof kbFixture>>,
  documentId: string,
  data: { filename: string; fileUrl: string; fileSize: number; mimeType: string },
  actor = f.actor,
  workspaceId = f.workspaceId,
  knowledgeBaseId = f.knowledgeBaseId
) {
  const { processDocumentAsync } = await import('./service')
  const attempt = processDocumentAsync(knowledgeBaseId, documentId, data, options, {
    actorUserId: actor,
    workspaceId,
  })
  activeDirect.add(attempt)
  try {
    return await attempt
  } finally {
    activeDirect.delete(attempt)
  }
}

suite('fresh canonical PostgreSQL KB source authorization', () => {
  beforeAll(async () => {
    ;({ db } = await import('@tradinggoose/db'))
    const [owned] = await db.execute(
      sql`SELECT current_database() AS database, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()`
    )
    expect(owned).toMatchObject(originalState!)
    // Genuine supported local queue mode; do not disable billing or inject queue/financial authority.
    await db
      .insert(tables.systemSettings)
      .values({ id: 'global', triggerDevEnabled: false })
      .onConflictDoUpdate({ target: tables.systemSettings.id, set: { triggerDevEnabled: false } })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected external source/provider contact')
      })
    )
    seams.embed.mockImplementation(() => {
      throw new Error('Unexpected embedding/model contact')
    })
    seams.process.mockImplementation(
      async (
        url: string,
        filename: string,
        mimeType: string,
        context: KnowledgeDocumentSourceContext
      ) => {
        seams.jobStages.push('actual-document-processor-entry')
        const ownGate = gate
        if (ownGate) await ownGate
        const { readKnowledgeDocumentSource } = await import('./storage')
        const bytes = await readKnowledgeDocumentSource(url, filename, context)
        seams.jobStages.push('actual-source-read-returned')
        return {
          chunks: [],
          metadata: {
            filename,
            fileSize: bytes.length,
            mimeType,
            chunkCount: 0,
            tokenCount: 0,
            characterCount: bytes.length,
            processingMethod: 'file-parser',
          },
        }
      }
    )
    // Resolve this actual public graph before the bounded5s case; no app provider/native calls.
    await import('@/app/api/files/upload/route')
    await import('@/app/api/knowledge/[id]/documents/route')
    await import('@/background/pending-execution-job')
    seams.jobStages.push('real-document-dispatcher-preloaded')
  })
  afterEach(async () => {
    for (const release of releaseGates) release()
    releaseGates.clear()
    gate = undefined
    await Promise.allSettled([...activeDirect])
    await awaitPendingClosure()
    seams.session = null
    seams.downloaded.mockClear()
    seams.process.mockClear()
  })
  afterAll(async () => {
    if (!db) return
    // On closure failure this throws BEFORE ending the pool, preserving evidence for owner cleanup.
    for (const release of releaseGates) release()
    await Promise.allSettled([...activeDirect])
    await awaitPendingClosure()
    expect(seams.embed).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    await db.$client.end()
    vi.unstubAllGlobals()
  })

  it('uses actual upload, canonical document creation, queued actor and fresh processing authorization before direct source IO', async () => {
    const f = await kbFixture()
    seams.session = { user: { id: f.actor, email: `${f.actor}@invalid.test` } }
    const form = new FormData()
    form.append('file', new File(['source bytes'], 'uploaded.txt', { type: 'text/plain' }))
    form.append('workspaceId', f.workspaceId)
    form.append('knowledgeBaseId', f.knowledgeBaseId)
    const { POST: upload } = await import('@/app/api/files/upload/route')
    const response = await upload(
      new NextRequest(`${sourceBase}/api/files/upload?type=knowledge-base`, {
        method: 'POST',
        body: form,
      })
    )
    expect(response.status).toBe(200)
    const uploaded = await response.json()
    const key = `${f.workspaceId}/${f.knowledgeBaseId}/uploaded.txt`
    expect(seams.uploaded).toHaveBeenCalledWith(key)
    const release = holdProcessing()
    let documentId: string | undefined
    try {
      const { POST: create } = await import('@/app/api/knowledge/[id]/documents/route')
      const created = await create(
        new NextRequest(`${sourceBase}/api/knowledge/${f.knowledgeBaseId}/documents`, {
          method: 'POST',
          body: JSON.stringify({
            filename: 'uploaded.txt',
            fileUrl: new URL(uploaded.path, sourceBase).toString(),
            fileSize: uploaded.size,
            mimeType: uploaded.type,
          }),
        }),
        { params: Promise.resolve({ id: f.knowledgeBaseId }) }
      )
      expect(created.status).toBe(200)
      const body = await created.json()
      documentId = body.data.id
      const taskId = body.data.taskId
      expect(typeof documentId).toBe('string')
      expect(typeof taskId).toBe('string')
      pendingIds.add(taskId)
      const [queued] = await db
        .select()
        .from(tables.pendingExecution)
        .where(eq(tables.pendingExecution.id, taskId))
      expect(queued).toMatchObject({
        userId: f.actor,
        workspaceId: f.workspaceId,
        executionType: 'document',
        status: 'processing',
      })
      await vi.waitFor(() => expect(seams.process).toHaveBeenCalledOnce())
      expect(seams.jobStages).toContain('actual-document-processor-entry')
      expect(queued.payload).toMatchObject({
        userId: f.actor,
        workspaceId: f.workspaceId,
        knowledgeBaseId: f.knowledgeBaseId,
        documentId,
      })
      expect(seams.downloaded).not.toHaveBeenCalled()
    } finally {
      release()
    }
    await awaitPendingClosure()
    expect(seams.downloaded).toHaveBeenCalledExactlyOnceWith(key)
    const [document] = await db
      .select()
      .from(tables.document)
      .where(eq(tables.document.id, documentId!))
    expect(document.processingStatus).toBe('completed')
    expect(seams.embed).not.toHaveBeenCalled()
  })

  it.each([
    'foreign-actor',
    'revoked-write',
    'deleted-KB',
    'deleted-document',
    'wrong-workspace',
    'wrong-KB-pair',
    'changed-queued-metadata',
    'cross-KB-stored-key',
    'archive-stored-key',
  ])(
    'preserves actual existing document/embeddings and makes zero source/model contacts on %s',
    async (kind) => {
      const f = await kbFixture()
      const doc = await retainedDocument(f)
      let actor = f.actor
      let workspaceId = f.workspaceId
      let knowledgeBaseId = f.knowledgeBaseId
      if (kind === 'foreign-actor') actor = f.foreign
      if (kind === 'revoked-write')
        await db
          .delete(tables.permissions)
          .where(
            and(
              eq(tables.permissions.entityId, f.workspaceId),
              eq(tables.permissions.userId, f.actor)
            )
          )
      if (kind === 'deleted-KB')
        await db
          .update(tables.knowledgeBase)
          .set({ deletedAt: new Date() })
          .where(eq(tables.knowledgeBase.id, f.knowledgeBaseId))
      if (kind === 'deleted-document')
        await db
          .update(tables.document)
          .set({ deletedAt: new Date() })
          .where(eq(tables.document.id, doc.documentId))
      if (kind === 'wrong-workspace') workspaceId = 'synthetic-wrong-workspace'
      if (kind === 'wrong-KB-pair') knowledgeBaseId = f.otherKnowledgeBaseId
      if (kind === 'changed-queued-metadata') doc.data.filename = 'different.txt'
      if (kind === 'cross-KB-stored-key' || kind === 'archive-stored-key') {
        const bad =
          kind === 'cross-KB-stored-key'
            ? `${f.workspaceId}/${f.otherKnowledgeBaseId}/retained.txt`
            : 'workflow-archive/retained.txt'
        doc.data.fileUrl = `${sourceBase}/api/files/serve/s3/${encodeURIComponent(bad)}?context=knowledge-base`
        await db
          .update(tables.document)
          .set({ fileUrl: doc.data.fileUrl })
          .where(eq(tables.document.id, doc.documentId))
      }
      const before = await retainedState(doc.documentId)
      await expect(
        directProcessing(f, doc.documentId, doc.data, actor, workspaceId, knowledgeBaseId)
      ).rejects.toThrow()
      expect(await retainedState(doc.documentId)).toEqual(before)
      expect(seams.process).not.toHaveBeenCalled()
      expect(seams.downloaded).not.toHaveBeenCalled()
      expect(seams.embed).not.toHaveBeenCalled()
    }
  )

  it('does not mutate a foreign document through background failure finalization', async () => {
    const f = await kbFixture()
    const doc = await retainedDocument(f)
    const before = await retainedState(doc.documentId)
    const { markDocumentProcessingFailed } = await import('./service')
    await expect(
      markDocumentProcessingFailed(
        f.knowledgeBaseId,
        doc.documentId,
        doc.data,
        { actorUserId: f.foreign, workspaceId: f.workspaceId },
        'synthetic worker error'
      )
    ).rejects.toThrow()
    expect(await retainedState(doc.documentId)).toEqual(before)
    expect(seams.downloaded).not.toHaveBeenCalled()
  })
})
