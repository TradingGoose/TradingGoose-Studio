import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import {
  isRunFenceConflictError,
  type MemoryStorage,
  type RunFence,
  TABLE_MESSAGES,
  type WorkflowsStorage,
} from '@mastra/core/storage'
import { Memory } from '@mastra/memory'
import {
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@tradinggoose/db/schema'
import { sql as statement } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  admitFinancialModelStep,
  createFinancialInvocation,
  financialSchedulerReady,
} from '@/lib/billing/native-finance'
import { decryptSecret } from '@/lib/utils-server'
import {
  claimWorkflowCheckpoint,
  readWorkflowCheckpointSnapshot,
  saveWorkflowCheckpoint,
  submitWorkflowCheckpoint,
} from '@/lib/workflows/human-in-the-loop/service'
import {
  type WorkflowCheckpointSnapshot,
  workflowResumeJobId,
} from '@/lib/workflows/human-in-the-loop/types'
import { createMinimalWorkflow, createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { finalizeExecutorCheckpoint, saveExecutionContext } from '@/executor/checkpoint'
import {
  encodeWorkflowTransfer,
  getWorkflowMessageSource,
  type WorkflowMessage,
  workflowMessageDigest,
} from './messages'
import * as runtime from './runtime'
import { createNativeStorage, PASSIVE_MEMORY_OPTIONS } from './runtime'
import {
  appendWorkflowMemory as actualAppend,
  deleteWorkflowMemory as actualDelete,
  getWorkflowMemory as actualGet,
  getAllWorkflowMemory as actualGetAll,
  cleanupOrphanWorkflowMemory,
  cleanupOrphanWorkflowMemoryPage,
  workflowMemoryIdentity,
} from './workflow-memory'

const fixture = vi.hoisted(() => ({
  url: process.env.DATABASE_URL,
  client: undefined as ReturnType<typeof import('postgres').default> | undefined,
  db: undefined as typeof import('@tradinggoose/db').db | undefined,
  actorUserId: '',
}))
vi.mock('@tradinggoose/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  const schema = await import('@tradinggoose/db/schema')
  if (!process.env.SOURCE_BILLING_TEST_STATE_FILE) return { db: {} }
  if (!fixture.url) throw new Error('Exact canonical studio_app DATABASE_URL required')
  fixture.client = postgres(fixture.url, { max: 8, prepare: false })
  fixture.db = drizzle(fixture.client, { schema })
  return { db: fixture.db }
})
// Keep actual save/submit/claim SQL, input validation and authorization; only the external
// worker-dispatch transport is inert. No queue job/effect is executed by this source fixture.
vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: async (args: {
    pendingExecutionId: string
    beforeEnqueue: Parameters<NonNullable<typeof fixture.db>['transaction']>[0]
  }) => {
    if (!fixture.db) throw new Error('Canonical application DB fixture unavailable')
    const ready = await fixture.db.transaction(args.beforeEnqueue)
    return { inserted: ready, pendingExecutionId: args.pendingExecutionId }
  },
  isPendingWorkflowExecutionCancellationRequested: async () => false,
  PENDING_EXECUTION_CANCELLATION_ERROR: 'Workflow execution was cancelled',
}))
vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: { API_KEY: 'api_key' },
  checkSessionOrInternalAuth: vi.fn(async () => ({ success: true, userId: fixture.actorUserId })),
}))

function refuse(message = 'Explicit NEW owned canonical Memory fixture required'): never {
  throw new Error(message)
}
const roleSchema = z.object({ name: z.string(), password: z.string().min(1) })
const stateSchema = z.object({
  version: z.literal('r15-v1'),
  stage: z.literal('ready'),
  smoke: z.unknown().optional(),
  statePath: z.string(),
  id: z.string().regex(/^[a-f0-9]{16}$/),
  database: z.string(),
  marker: z.string().regex(/^r15-v1:[a-f0-9]{48}$/),
  operator: z.string(),
  roles: z.object({ owner: roleSchema, studio_app: roleSchema, studio_native: roleSchema }),
  actors: z.array(z.object({ userId: z.string().min(1), workspaceId: z.string().min(1) })).min(1),
})
function loopback(value: string, maintenance = false) {
  const url = new URL(value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash ||
    (maintenance && url.pathname !== '/postgres')
  )
    refuse()
  return url
}
function readOwnedFixture() {
  const path = process.env.SOURCE_BILLING_TEST_STATE_FILE
  if (!path) return null
  if (
    process.env.FIXTURE_MUTATION_OPT_IN !== 'r15-v1-fresh-disposable' ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    realpathSync(path) !== path ||
    basename(path) !== 'state.json' ||
    !/^db-private-[a-z0-9]+$/.test(basename(dirname(path)))
  )
    refuse()
  const file = lstatSync(path)
  const parent = lstatSync(dirname(path))
  const uid = process.getuid?.()
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.nlink !== 1 ||
    uid === undefined ||
    file.uid !== uid ||
    (file.mode & 0o777) !== 0o600 ||
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
  const state = stateSchema.parse(JSON.parse(bytes.toString('utf8')))
  const app = loopback(fixture.url ?? '')
  const operator = loopback(state.operator, true)
  if (
    state.smoke ||
    state.statePath !== path ||
    state.database !== `r15_${state.id}` ||
    app.protocol !== operator.protocol ||
    app.port !== operator.port ||
    app.pathname !== `/${state.database}` ||
    app.username !== state.roles.studio_app.name ||
    app.password !== state.roles.studio_app.password ||
    Object.keys(process.env).some((key) => key.startsWith('PG') && process.env[key])
  )
    refuse()
  for (const name of ['owner', 'studio_app', 'studio_native'] as const)
    if (state.roles[name].name !== `r15_${state.id}_${name}`) refuse()
  const roleUrl = (name: 'owner' | 'studio_native') => {
    const url = new URL(operator)
    url.username = state.roles[name].name
    url.password = state.roles[name].password
    url.pathname = `/${state.database}`
    return url.href
  }
  const control = new URL(operator)
  control.pathname = `/${state.database}`
  if (
    process.env.MASTRA_DATABASE_URL &&
    process.env.MASTRA_DATABASE_URL !== roleUrl('studio_native')
  )
    refuse()
  const epoch = Number(process.env.F1_HARNESS_WORK_DEADLINE_EPOCH_MS)
  if (!Number.isSafeInteger(epoch) || epoch <= Date.now())
    refuse('Actual once-issued fixture work deadline required')
  const reportPath = process.env.F1_HARNESS_REPORT_FILE
  if (
    !reportPath ||
    !isAbsolute(reportPath) ||
    resolve(reportPath) !== reportPath ||
    dirname(reportPath) !== dirname(path) ||
    existsSync(reportPath)
  )
    refuse('Fresh owned lifecycle report path required')
  return {
    state,
    ownerUrl: roleUrl('owner'),
    nativeUrl: roleUrl('studio_native'),
    controlUrl: control.href,
    reportPath,
    workEnds: performance.now() + Math.max(0, epoch - Date.now()),
  }
}
const owned = readOwnedFixture()
type Owned = NonNullable<typeof owned>
type ControlSql = Pick<ReturnType<typeof postgres>, 'unsafe'>
const tests = owned ? describe : describe.skip
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
type Context = { caseId: string; operationId?: number }
type Kind = 'body' | 'facade' | 'callback' | 'delegate' | 'control' | 'cleanup'
type Task = {
  sequence: number
  caseId: string
  operationId?: number
  kind: Kind
  method: string
  startedAt: number
  dispatchedAt?: number
  endedAt?: number
  outcome: 'pending' | 'fulfilled' | 'rejected'
  code?: string
  promise: Promise<unknown>
}
const context = new AsyncLocalStorage<Context>()
const known: Task[] = []
const caseStates = new Map<string, boolean>()
const declaredScenarios: Array<{ caseId: string; name: string; method: 'scenario' }> = []
const caseOutcomes = new Map<string, 'not-executed' | 'passed' | 'failed' | 'timed-out'>()
const callbacks: Array<{
  caseId: string
  operationId?: number
  pid?: number
  enteredAt: number
  ended: boolean
}> = []
const stages: Array<Record<string, unknown>> = []
let sequence = 0
let accepting = true
const closeAdmissions = (reason: string) => {
  accepting = false
  stages.push({
    caseId: context.getStore()?.caseId ?? 'suite',
    stage: 'admission-closed',
    reason,
    at: performance.now(),
  })
}
function trace(stage: string, facts: Record<string, unknown> = {}) {
  const row = {
    caseId: context.getStore()?.caseId ?? 'suite',
    operationId: context.getStore()?.operationId,
    stage,
    at: performance.now(),
    ...facts,
  }
  stages.push(row)
  console.log(`CURRENT_MEMORY_STAGE ${JSON.stringify(row)}`)
}
function observe<T>(
  kind: Kind,
  method: string,
  run: () => Promise<T>,
  cleanup = false
): Promise<T> {
  const parent = context.getStore() ?? { caseId: 'suite.setup' }
  let resolveTask!: (value: T | PromiseLike<T>) => void
  let rejectTask!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolveTask = yes
    rejectTask = no
  })
  // Independent lifetime observation; callers still receive the original rejecting promise.
  void promise.then(
    () => undefined,
    () => undefined
  )
  const id = ++sequence
  const child = { ...parent, operationId: kind === 'facade' ? id : parent.operationId }
  const record: Task = {
    sequence: id,
    ...child,
    kind,
    method,
    startedAt: performance.now(),
    outcome: 'pending',
    promise,
  }
  known.push(record)
  context.run(child, () => {
    void Promise.resolve()
      .then(() => {
        if (
          !cleanup &&
          (!accepting ||
            caseStates.get(child.caseId) === false ||
            (owned && performance.now() >= owned.workEnds))
        )
          refuse('Fixture admission closed')
        record.dispatchedAt = performance.now()
        return run()
      })
      .then(
        (value) => {
          record.outcome = 'fulfilled'
          record.endedAt = performance.now()
          resolveTask(value)
        },
        (error: unknown) => {
          record.outcome = 'rejected'
          record.endedAt = performance.now()
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'string'
          )
            record.code = error.code
          rejectTask(error)
        }
      )
  })
  return promise
}
const appendWorkflowMemory = (...args: Parameters<typeof actualAppend>) =>
  observe('facade', 'append', () => actualAppend(...args))
const getWorkflowMemory = (...args: Parameters<typeof actualGet>) =>
  observe('facade', 'get', () => actualGet(...args))
const getAllWorkflowMemory = (...args: Parameters<typeof actualGetAll>) =>
  observe('facade', 'getAll', () => actualGetAll(...args))
const deleteWorkflowMemory = (...args: Parameters<typeof actualDelete>) =>
  observe('facade', 'delete', () => actualDelete(...args))
async function drain(milliseconds: number, callsOnly = false) {
  const until = performance.now() + Math.max(0, milliseconds)
  for (;;) {
    const pending = known.filter(
      (task) =>
        task.outcome === 'pending' &&
        (!callsOnly || ['facade', 'callback', 'delegate'].includes(task.kind))
    )
    if (!pending.length) return true
    const remaining = until - performance.now()
    if (remaining <= 0) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), remaining)
    })
    const settled = Promise.all(
      pending.map((task) =>
        task.promise.then(
          () => undefined,
          () => undefined
        )
      )
    ).then(() => true)
    const result = await Promise.race([settled, expired])
    if (timer) clearTimeout(timer)
    if (!result) return false
  }
}
function caseIt(caseId: string, name: string, body: () => Promise<void>) {
  if (declaredScenarios.some((entry) => entry.caseId === caseId))
    refuse('Duplicate declared data case')
  declaredScenarios.push({ caseId, name, method: 'scenario' })
  caseOutcomes.set(caseId, 'not-executed')
  it(name, async () => {
    if (!accepting || !owned || performance.now() >= owned.workEnds)
      refuse('Fixture case admission closed')
    const caseDeadline = Math.min(performance.now() + 5000, owned.workEnds)
    caseStates.set(caseId, true)
    const task = context.run({ caseId }, () => observe('body', 'scenario', body))
    void task.then(
      () => {
        caseStates.set(caseId, false)
      },
      () => {
        caseStates.set(caseId, false)
        closeAdmissions(`body:${caseId}`)
      }
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          caseOutcomes.set(caseId, 'timed-out')
          closeAdmissions(`timeout:${caseId}`)
          reject(new Error('Aggregate Memory fixture case deadline'))
        },
        Math.max(0, caseDeadline - performance.now())
      )
    })
    try {
      await Promise.race([task, timeout])
      if (performance.now() >= caseDeadline) {
        caseOutcomes.set(caseId, 'timed-out')
        closeAdmissions(`late-completion:${caseId}`)
        throw new Error('Aggregate Memory fixture case deadline')
      }
      caseOutcomes.set(caseId, 'passed')
    } catch (error) {
      if (caseOutcomes.get(caseId) !== 'timed-out') caseOutcomes.set(caseId, 'failed')
      closeAdmissions(`scenario-result:${caseId}`)
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, 5000)
}
const outcomeOf = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  )
async function requiredStage(
  gate: ReturnType<typeof deferred>,
  operation: Promise<unknown>,
  name: string
) {
  await Promise.race([
    gate.promise,
    operation.then(
      () => {
        throw new Error(`Required public stage not reached: ${name}`)
      },
      (error: unknown) => {
        throw error
      }
    ),
  ])
}
async function poll<T>(
  run: () => Promise<T | undefined>,
  deadline: number,
  label: string
): Promise<T> {
  while (performance.now() < deadline) {
    const result = await run()
    if (result !== undefined) return result
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(10, Math.max(0, deadline - performance.now())))
    )
  }
  throw new Error(`Required actual witness not observed: ${label}`)
}
function hasSqlState(error: unknown, code: string) {
  const seen = new Set<object>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    if ('code' in error && error.code === code) return true
    error = 'cause' in error ? error.cause : undefined
  }
  return false
}
const messagesTable = (() => {
  if (!/^[a-z_][a-z0-9_]*$/.test(TABLE_MESSAGES)) refuse()
  return `"mastra"."${TABLE_MESSAGES}"`
})()
const roleIdentifier = (value: string) => {
  if (!/^r15_[a-f0-9]{16}_studio_native$/.test(value)) refuse()
  return `"${value}"`
}
async function guardControl(connection: ControlSql, input: Owned, restoration = false) {
  const active = context.getStore()
  if (
    !restoration &&
    (!accepting ||
      (active && caseStates.get(active.caseId) === false) ||
      performance.now() >= input.workEnds)
  )
    refuse('Normal fixture control admission closed')
  const rows = await connection.unsafe(`SELECT current_database() AS database,
    pg_get_userbyid(d.datdba) AS owner, shobj_description(d.oid,'pg_database') AS marker
    FROM pg_database d WHERE d.datname=current_database()`)
  if (
    rows.length !== 1 ||
    rows[0].database !== input.state.database ||
    rows[0].owner !== input.state.roles.owner.name ||
    rows[0].marker !== input.state.marker
  )
    refuse()
}
type Backend = {
  pid: number
  role: 'studio_app' | 'studio_native'
  backendStart: string
  xactStart: string
}
async function backend(
  connection: ControlSql,
  input: Owned,
  pid: number,
  role: Backend['role']
): Promise<Backend> {
  if (!Number.isSafeInteger(pid) || pid < 1) refuse()
  await guardControl(connection, input)
  await connection.unsafe('SELECT pg_stat_clear_snapshot()')
  const rows = await connection.unsafe(
    `SELECT backend_start::text AS backend_start, xact_start::text AS xact_start
    FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND usename=$3 AND xact_start IS NOT NULL`,
    [pid, input.state.database, input.state.roles[role].name]
  )
  if (
    rows.length !== 1 ||
    typeof rows[0].backend_start !== 'string' ||
    typeof rows[0].xact_start !== 'string'
  )
    refuse()
  return { pid, role, backendStart: rows[0].backend_start, xactStart: rows[0].xact_start }
}
async function terminateHolder(
  connection: ControlSql,
  input: Owned,
  target: Backend,
  workspaceId: string,
  workflowId: string,
  key: string
) {
  if (target.role !== 'studio_app') refuse()
  await guardControl(connection, input)
  await connection.unsafe('SELECT pg_stat_clear_snapshot()')
  const rows = await connection.unsafe(
    `SELECT pg_terminate_backend(a.pid) AS terminated
    FROM pg_stat_activity a WHERE a.pid=$1 AND a.datname=$2 AND a.usename=$3
      AND a.backend_start::text=$4 AND a.xact_start::text=$5
      AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.locktype='advisory'
        AND l.granted AND l.classid=1904202617
        AND l.objid::bigint=(hashtext($6)::bigint & 4294967295))`,
    [
      target.pid,
      input.state.database,
      input.state.roles.studio_app.name,
      target.backendStart,
      target.xactStart,
      JSON.stringify(['workflow-memory-key', workspaceId, workflowId, key]),
    ]
  )
  if (rows.length !== 1 || rows[0].terminated !== true)
    refuse('Exact owned app holder termination refused')
  trace('actual-app-holder-terminated', { pid: target.pid, workflowId, key })
}

tests('current canonical disposable workflow Memory locking and ownership', () => {
  let input: Owned
  let native: ReturnType<typeof createNativeStorage>
  let memory: Memory
  let initializer: ReturnType<typeof createNativeStorage> | undefined
  let store: MemoryStorage
  let workflows: WorkflowsStorage
  let control: ReturnType<typeof postgres>
  let controlCreated = false
  let workspaceId = ''
  let workflowId = ''
  let otherWorkflow = ''
  const checkpointFixture = {
    actor: '',
    workspace: '',
    workflow: '',
    logId: '',
    executionId: '',
    snapshotId: '',
    sourceKey: 'checkpoint-resume-source',
  }
  const auth = { success: true, userId: '' }
  const scopes: string[] = []
  const users: string[] = []
  let orderingWorkflow = ''
  let capWorkflow = ''
  const capLive: Array<{ key: string; createdAt: number }> = []
  let oldOrderingContainerCreatedAt = 0
  const orderingLive: Array<{ key: string; createdAt: number }> = []
  let originalThreadDelete: MemoryStorage['deleteThread'] | undefined
  const database = () => fixture.db ?? refuse('Canonical application DB fixture unavailable')
  const appClient = () => fixture.client ?? refuse('Canonical application client unavailable')
  async function createWorkflow(
    id: string,
    targetWorkspace = workspaceId,
    targetActor = auth.userId
  ) {
    const at = new Date()
    await observe('control', 'fixture.workflow.insert', async () => {
      await database().insert(workflow).values({
        id,
        userId: targetActor,
        workspaceId: targetWorkspace,
        name: 'Disposable Memory workflow',
        lastSynced: at,
        createdAt: at,
        updatedAt: at,
      })
    })
  }
  function wrapDomain(domain: object, names: string[]) {
    for (const name of names) {
      const original = Reflect.get(domain, name)
      if (typeof original !== 'function') refuse(`Selected public method unavailable: ${name}`)
      Reflect.set(domain, name, (...args: unknown[]) =>
        observe('delegate', name, async () => await Reflect.apply(original, domain, args))
      )
    }
  }
  async function seed(
    key: string,
    count: number,
    owner = workflowId,
    targetWorkspace = workspaceId,
    supplied?: WorkflowMessage[]
  ) {
    if (!Number.isSafeInteger(count) || count < 0) refuse()
    const identity = workflowMemoryIdentity(targetWorkspace, owner, key)
    const runId = `workflow-memory-ownership:${identity.threadId}`
    const ownerId = randomUUID()
    if (await memory.getThreadById(identity))
      refuse('Fixture seed would overwrite an existing thread')
    const observed = await workflows.getRunOwnership({ runId })
    if (observed !== null) refuse('New exclusive fixture key already has an ownership record')
    const claim = await workflows.claimRunOwnership({
      runId,
      ownerId,
      expectedGeneration: 0,
      leaseMs: 6000,
    })
    if (
      !claim.acquired ||
      claim.record.runId !== runId ||
      claim.record.ownerId !== ownerId ||
      !Number.isSafeInteger(claim.record.generation) ||
      claim.record.generation < 1
    )
      refuse()
    const fence: RunFence = { runId, ownerId, generation: claim.record.generation }
    if (!(await store.raiseRunFence(fence))) refuse()
    const thread = await memory.createThread({ ...identity, title: key, saveThread: false })
    await store.saveThread({ thread, fence })
    const messages = encodeWorkflowTransfer(
      supplied ??
        Array.from({ length: count }, (_, i) => ({
          role: i % 2 ? 'user' : 'system',
          content: ` ${i}🔥\n`,
        })),
      identity,
      new Date(),
      randomUUID()
    )
    for (let offset = 0; offset < messages.length; offset += 100) {
      const collisions = await store.listMessagesById({
        messageIds: messages.slice(offset, offset + 100).map(({ id }) => id),
      })
      if (collisions.messages.length) refuse('Fixture seed ID collision')
    }
    await store.saveMessages({ messages, fence })
    scopes.push(identity.threadId)
    return identity
  }
  function currentCallback(operationId = context.getStore()?.operationId) {
    if (!Number.isSafeInteger(operationId)) refuse('Actual facade identity unavailable')
    const candidates = callbacks.filter(
      (entry) =>
        !entry.ended &&
        entry.operationId === operationId &&
        entry.caseId === context.getStore()?.caseId
    )
    const selected = candidates[0]
    if (candidates.length !== 1 || !selected?.pid) refuse('Exact actual callback PID unavailable')
    return { ...selected, pid: selected.pid }
  }
  async function actualHolder(
    key: string,
    operationId = context.getStore()?.operationId,
    connection: ControlSql = control
  ) {
    const callback = currentCallback(operationId)
    const captured = await backend(connection, input, callback.pid, 'studio_app')
    await guardControl(connection, input)
    const locks = await connection.unsafe(
      `SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory'
      AND granted AND classid=1904202617 AND objid::bigint=(hashtext($2)::bigint & 4294967295)`,
      [captured.pid, JSON.stringify(['workflow-memory-key', workspaceId, workflowId, key])]
    )
    if (locks.length !== 1) refuse('Actual owning key-lock witness unavailable')
    return { captured, enteredAt: callback.enteredAt }
  }
  async function nativeTimes(key: string, owner = workflowId) {
    const identity = workflowMemoryIdentity(workspaceId, owner, key)
    const thread = await store.getThreadById(identity)
    if (!thread) refuse('Expected retained physical thread')
    const createdAt = new Date(thread.createdAt).getTime()
    const updatedAt = new Date(thread.updatedAt).getTime()
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt))
      refuse('Public native timestamps unavailable')
    return { createdAt, updatedAt }
  }
  async function postCreated(key: string, content: string, owner = workflowId) {
    const { POST } = await import('@/app/api/memory/route')
    const response = await POST(
      new NextRequest('http://fixture.invalid/api/memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'agent',
          workflowId: owner,
          key,
          data: { role: 'assistant', content },
        }),
      })
    )
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.success).toBe(true)
    const record = await getWorkflowMemory(auth, owner, key)
    expect(body.data.id).toBe(record.id)
    expect(body.data.sourceRefs).toEqual(record.sourceRefs)
    if (!scopes.includes(record.id)) scopes.push(record.id)
    return record
  }
  beforeAll(
    () =>
      context.run({ caseId: 'suite.setup' }, () =>
        observe('body', 'suite.setup', async () => {
          if (!owned) refuse()
          input = owned
          control = postgres(input.controlUrl, {
            max: 1,
            prepare: false,
            connect_timeout: 5,
            idle_timeout: 2,
            onnotice: () => {},
          })
          controlCreated = true
          await guardControl(control, input)
          const ownerFactory = await observe('control', 'owner.native.factory', async () =>
            createNativeStorage(input.ownerUrl, true)
          )
          initializer = ownerFactory
          try {
            await observe('delegate', 'owner.native.init', () => ownerFactory.storage.init())
            await observe('delegate', 'owner.native.capabilities', () =>
              ownerFactory.verifyCapabilities()
            )
          } finally {
            await observe('cleanup', 'owner.native.close', () => ownerFactory.close(), true)
          }
          native = await observe('control', 'runtime.native.factory', async () =>
            createNativeStorage(input.nativeUrl)
          )
          await observe('delegate', 'runtime.native.capabilities', () =>
            native.verifyCapabilities()
          )
          const selectedMemory = await observe('delegate', 'runtime.native.memory-domain', () =>
            native.storage.getStore('memory')
          )
          const selectedWorkflows = await observe(
            'delegate',
            'runtime.native.workflows-domain',
            () => native.storage.getStore('workflows')
          )
          if (!selectedMemory || !selectedWorkflows) refuse()
          store = selectedMemory
          workflows = selectedWorkflows
          expect(await store.supportsRunFencing()).toBe(true)
          expect(await workflows.supportsRunFencing()).toBe(true)
          memory = new Memory({ storage: native.storage, options: PASSIVE_MEMORY_OPTIONS })
          originalThreadDelete = store.deleteThread.bind(store)
          wrapDomain(store, [
            'saveThread',
            'saveMessages',
            'deleteMessages',
            'getThreadById',
            'listMessages',
            'listMessagesById',
            'listThreads',
            'raiseRunFence',
          ])
          wrapDomain(workflows, ['getRunOwnership', 'claimRunOwnership'])
          wrapDomain(memory, ['createThread', 'getThreadById', 'listThreads'])
          const db = database()
          const originalTransaction = db.transaction.bind(db)
          db.transaction = (run, config) => {
            const captured = context.getStore() ?? { caseId: 'suite.setup' }
            return originalTransaction(
              (tx) =>
                context.run(captured, () =>
                  observe('callback', 'app.transaction.callback', async () => {
                    const entry: {
                      caseId: string
                      operationId?: number
                      enteredAt: number
                      ended: boolean
                      pid?: number
                    } = { ...captured, enteredAt: performance.now(), ended: false }
                    callbacks.push(entry)
                    try {
                      const pids = await tx.execute<{ pid: number }>(
                        statement`select pg_backend_pid() as pid`
                      )
                      if (pids.length !== 1 || !Number.isSafeInteger(pids[0].pid))
                        refuse('Actual app PID unavailable')
                      entry.pid = pids[0].pid
                      return await run(tx)
                    } finally {
                      entry.ended = true
                    }
                  })
                ),
              config
            )
          }
          const at = new Date()
          auth.userId = `memory-owner-${randomUUID()}`
          fixture.actorUserId = auth.userId
          workspaceId = `memory-ws-${randomUUID()}`
          workflowId = `memory-wf-${randomUUID()}`
          otherWorkflow = `memory-other-${randomUUID()}`
          await observe('control', 'fixture.user.insert', async () => {
            await db.insert(user).values({
              id: auth.userId,
              name: 'Disposable Memory owner',
              email: `${auth.userId}@invalid.test`,
              emailVerified: true,
              createdAt: at,
              updatedAt: at,
            })
          })
          users.push(auth.userId)
          await observe('control', 'fixture.workspace.insert', async () => {
            await db.insert(workspace).values({
              id: workspaceId,
              name: 'Disposable Memory workspace',
              ownerId: auth.userId,
              billingOwnerType: 'user',
              billingOwnerUserId: auth.userId,
            })
          })
          await createWorkflow(workflowId)
          await createWorkflow(otherWorkflow)
          // Genuine original finance belongs to an already auth-provisioned canonical actor,
          // never the unprovisioned synthetic Memory owner used for unrelated lock schedules.
          const actor = input.state.actors[0]
          if (!actor || !financialSchedulerReady())
            refuse(
              'Actual canonical scheduler-ready original actor required for E6 checkpoint admission'
            )
          Object.assign(checkpointFixture, {
            actor: actor.userId,
            workspace: actor.workspaceId,
            workflow: `memory-checkpoint-${randomUUID()}`,
            logId: randomUUID(),
            executionId: randomUUID(),
            snapshotId: randomUUID(),
          })
          await createWorkflow(
            checkpointFixture.workflow,
            checkpointFixture.workspace,
            checkpointFixture.actor
          )
          await observe('control', 'E6.original.financial.log.setup', async () => {
            const binding = await createFinancialInvocation({
              actorUserId: checkpointFixture.actor,
              workspaceId: checkpointFixture.workspace,
              workflowId: checkpointFixture.workflow,
              runId: checkpointFixture.executionId,
              operationKey: checkpointFixture.executionId,
              purpose: 'workflow-execution',
              quotedHoldUsd: '0.1',
            })
            await admitFinancialModelStep(binding, {
              stepNumber: 0,
              retryCount: 0,
              runId: checkpointFixture.executionId,
            })
            await db.insert(workflowExecutionSnapshots).values({
              id: checkpointFixture.snapshotId,
              workflowId: checkpointFixture.workflow,
              workspaceId: checkpointFixture.workspace,
              stateHash: 'E6-original-graph',
              stateData: { blocks: {}, edges: [], loops: {}, parallels: {} },
            })
            await db.insert(workflowExecutionLogs).values({
              id: checkpointFixture.logId,
              workflowId: checkpointFixture.workflow,
              workspaceId: checkpointFixture.workspace,
              executionId: checkpointFixture.executionId,
              stateSnapshotId: checkpointFixture.snapshotId,
              workflowSummary: { id: checkpointFixture.workflow, name: 'E6 actual checkpoint' },
              level: 'info',
              trigger: 'manual',
              startedAt: at,
              executionData: {
                billing: { binding },
                environment: {
                  userId: checkpointFixture.actor,
                  workspaceId: checkpointFixture.workspace,
                  workflowId: checkpointFixture.workflow,
                  executionId: checkpointFixture.executionId,
                },
              },
            })
          })
          const checkpointMessages: WorkflowMessage[] = Array.from({ length: 103 }, (_, i) => ({
            role: i % 3 === 0 ? 'system' : i % 3 === 1 ? 'user' : 'assistant',
            content: i % 7 === 0 ? '' : i % 5 === 0 ? ' duplicate🔥\n ' : ` exact ${i}🔥\n `,
          }))
          await seed(
            checkpointFixture.sourceKey,
            checkpointMessages.length,
            checkpointFixture.workflow,
            checkpointFixture.workspace,
            checkpointMessages
          )

          for (const key of [
            'prior-save-N1',
            'prior-save-N2',
            'prior-save-N3',
            'actual-query-permission',
            'actual-sql-inflight',
          ])
            await seed(key, 2)
          // Case13 setup belongs to the unchanged beforeAll budget, not the timed GetAll request.
          orderingWorkflow = `memory-ordering-${randomUUID()}`
          await createWorkflow(orderingWorkflow)
          await seed('old-empty-container', 0, orderingWorkflow)
          oldOrderingContainerCreatedAt = (
            await nativeTimes('old-empty-container', orderingWorkflow)
          ).createdAt
          for (let i = 0; i < 51; i++)
            await seed(`empty-container-${String(i).padStart(2, '0')}`, 0, orderingWorkflow)
          for (let i = 0; i < 51; i++) {
            const key = `live-${String(i).padStart(2, '0')}`
            const identity = await seed(key, i === 50 ? 201 : 1, orderingWorkflow)
            const page = await store.listMessages({
              ...identity,
              page: 0,
              perPage: 1,
              includeTotal: true,
              orderBy: { field: 'createdAt', direction: 'ASC' },
            })
            expect(page.messages).toHaveLength(1)
            const createdAt = new Date(page.messages[0].createdAt).getTime()
            if (!Number.isFinite(createdAt))
              refuse('Actual public fixture chronology is unavailable')
            orderingLive.push({ key, createdAt })
          }
          // New cap/race oracles must not mutate or repeat the retained E9/R7 dataset.
          capWorkflow = `memory-cap-${randomUUID()}`
          await createWorkflow(capWorkflow)
          await seed('initial-empty-container', 0, capWorkflow)
          for (let i = 0; i < 51; i++) {
            const key = `live-${String(i).padStart(2, '0')}`
            const identity = await seed(key, i === 50 ? 201 : 1, capWorkflow)
            const page = await store.listMessages({
              ...identity,
              page: 0,
              perPage: 1,
              includeTotal: true,
              orderBy: { field: 'createdAt', direction: 'ASC' },
            })
            expect(page.messages).toHaveLength(1)
            const createdAt = new Date(page.messages[0].createdAt).getTime()
            if (!Number.isFinite(createdAt)) refuse('Actual isolated cap chronology is unavailable')
            capLive.push({ key, createdAt })
          }
        })
      ),
    60000
  )
  beforeEach(() => {
    vi.spyOn(runtime, 'getNativeMemory').mockResolvedValue(memory)
    vi.spyOn(runtime, 'getNativeMemoryStore').mockResolvedValue(store)
    vi.spyOn(runtime, 'getNativeWorkflowsStore').mockResolvedValue(workflows)
  })
  afterEach(async () => {
    const settled = await drain(4000, true)
    if (!settled) {
      closeAdmissions('known-calls-unsettled')
      throw new Error('Actual Memory callbacks/delegates unresolved')
    }
    if (!known.some((entry) => entry.kind === 'body' && entry.outcome === 'pending'))
      vi.restoreAllMocks()
  }, 5000)
  afterAll(async () => {
    closeAdmissions('suite-cleanup')
    const end = performance.now() + 19000
    let settled = false
    let failure: unknown
    const closes = {
      app: fixture.client ? 'pending' : 'not-created',
      native: native ? 'pending' : 'not-created',
      control: controlCreated ? 'pending' : 'not-created',
      initializer: initializer ? 'pending' : 'not-created',
    }
    let closeSnapshot = { ...closes }
    try {
      settled = await drain(Math.min(8000, Math.max(0, end - performance.now())))
      if (!settled)
        throw new Error('Known Memory bodies/callbacks/delegates unresolved; row cleanup skipped')
      vi.restoreAllMocks()
      // All fixture producers are known settled here. Physical fixture cleanup is NOT normal DELETE acceptance.
      const deleting = context.run({ caseId: 'suite.cleanup' }, () =>
        observe(
          'cleanup',
          'owned.rows.cleanup',
          async () => {
            const step = async (run: () => Promise<unknown>) => {
              if (!input || performance.now() >= Math.min(input.workEnds, end - 4000))
                throw new Error('Fixture row cleanup deadline')
              await run()
            }
            for (const threadId of scopes)
              await step(async () => {
                await originalThreadDelete?.({ threadId })
              })
            if (checkpointFixture.logId)
              await step(async () => {
                await appClient()`delete from workflow_execution_logs where id=${checkpointFixture.logId}`
              })
            if (checkpointFixture.snapshotId)
              await step(async () => {
                await appClient()`delete from workflow_execution_snapshots where id=${checkpointFixture.snapshotId}`
              })
            if (checkpointFixture.workflow)
              await step(async () => {
                await appClient()`delete from workflow where id=${checkpointFixture.workflow}`
              })
            await step(async () => {
              await appClient()`delete from workflow where workspace_id=${workspaceId}`
            })
            await step(async () => {
              await appClient()`delete from workspace where id=${workspaceId}`
            })
            for (const id of users)
              await step(async () => {
                await appClient()`delete from "user" where id=${id}`
              })
          },
          true
        )
      )
      let timer: ReturnType<typeof setTimeout> | undefined
      const bounded = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Actual fixture row cleanup unresolved')),
          Math.max(0, end - performance.now() - 4000)
        )
      })
      try {
        await Promise.race([deleting, bounded])
      } finally {
        if (timer) clearTimeout(timer)
      }
    } catch (error) {
      failure = error
    } finally {
      const close = (name: keyof typeof closes, run: () => Promise<unknown>) =>
        context
          .run({ caseId: 'suite.cleanup' }, () => observe('cleanup', `${name}.close`, run, true))
          .then(
            () => {
              closes[name] = 'fulfilled'
            },
            () => {
              closes[name] = 'rejected'
            }
          )
      const tasks: Promise<void>[] = []
      if (fixture.client)
        tasks.push(
          close('app', async () => {
            await fixture.client?.end({ timeout: 2 })
          })
        )
      if (native)
        tasks.push(
          close('native', async () => {
            await native.close()
          })
        )
      if (controlCreated)
        tasks.push(
          close('control', async () => {
            await control.end({ timeout: 2 })
          })
        )
      if (initializer)
        tasks.push(
          close('initializer', async () => {
            await initializer?.close()
          })
        )
      const all = Promise.all(tasks)
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        all,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, end - performance.now()))
        }),
      ])
      if (timer) clearTimeout(timer)
      closeSnapshot = { ...closes }
      const report = {
        settled,
        closes: closeSnapshot,
        pending: known
          .filter((entry) => entry.outcome === 'pending')
          .map(({ promise: _promise, ...entry }) => entry),
        tasks: known.map(({ promise: _promise, ...entry }) => entry),
        stages,
        hiddenDriverScopes: 'UNKNOWN',
        scenarios: declaredScenarios.map((declared) => {
          const entry = known.find(
            (task) =>
              task.kind === 'body' && task.method === 'scenario' && task.caseId === declared.caseId
          )
          const task = entry ? (({ promise: _promise, ...snapshot }) => snapshot)(entry) : undefined
          return {
            ...declared,
            status: caseOutcomes.get(declared.caseId) ?? 'not-executed',
            ...(task ? { task } : {}),
          }
        }),
        globalIdOwnerCas: 'UNSUPPORTED_NOT_TESTED',
        cleanupFailed: Boolean(failure),
      }
      if (owned)
        writeFileSync(owned.reportPath, `${JSON.stringify(report, null, 2)}\n`, {
          mode: 0o600,
          flag: 'wx',
        })
      console.log(`CURRENT_MEMORY_LIFECYCLE ${JSON.stringify(report)}`)
    }
    if (failure) throw failure
    expect(closeSnapshot).toEqual({
      app: 'fulfilled',
      native: 'fulfilled',
      control: 'fulfilled',
      initializer: 'fulfilled',
    })
    expect(known.filter((entry) => entry.outcome === 'pending')).toEqual([])
  }, 20000)
  caseIt(
    'E1',
    'returns all2001 exact messages through real primary readers and application advisory holders',
    async () => {
      await seed('long', 2001)
      const record = await getWorkflowMemory(auth, workflowId, 'long')
      expect(record.data).toHaveLength(2001)
      expect(record.data[2000]).toEqual({ role: 'system', content: ' 2000🔥\n' })
    }
  )
  caseIt(
    'E2',
    'holds the workspace barrier across pages and logically deletes exact captured messages before genuine201 recreation',
    async () => {
      await seed('contended', 201)
      await seed('other', 1, otherWorkflow)
      const entered = deferred()
      const release = deferred()
      const original = store.listMessages.bind(store)
      const spy = vi.spyOn(store, 'listMessages').mockImplementation(async (args) => {
        const result = await original(args)
        if (
          args.threadId === workflowMemoryIdentity(workspaceId, workflowId, 'contended').threadId &&
          args.page === 1
        ) {
          entered.resolve()
          await release.promise
        }
        return result
      })
      const reading = getWorkflowMemory(auth, workflowId, 'contended')
      const readingOutcome = outcomeOf(reading)
      try {
        await requiredStage(entered, readingOutcome, 'E2 actual second page')
        const before = spy.mock.calls.length
        const results = await Promise.allSettled([
          deleteWorkflowMemory(auth, workflowId, 'contended'),
          getWorkflowMemory(auth, otherWorkflow, 'other'),
        ])
        expect(results.every(({ status }) => status === 'rejected')).toBe(true)
        expect(spy.mock.calls.length).toBe(before)
        release.resolve()
        expect((await reading).data).toHaveLength(201)
      } finally {
        release.resolve()
        await readingOutcome
        expect(await drain(4000, true)).toBe(true)
        spy.mockRestore()
      }
      const nativeDelete = vi.spyOn(store, 'deleteThread')
      const capturedDelete = vi.spyOn(store, 'deleteMessages')
      try {
        const before = await getWorkflowMemory(auth, workflowId, 'contended')
        const physical = await nativeTimes('contended')
        await deleteWorkflowMemory(auth, workflowId, 'contended')
        expect(capturedDelete).toHaveBeenCalledWith(
          before.sourceRefs.map(({ messageId }) => messageId),
          expect.objectContaining({
            fence: expect.objectContaining({
              generation: expect.any(Number),
              ownerId: expect.any(String),
              runId: expect.any(String),
            }),
          })
        )
        expect(nativeDelete).not.toHaveBeenCalled()
        expect((await nativeTimes('contended')).createdAt).toBe(physical.createdAt)
        await expect(getWorkflowMemory(auth, workflowId, 'contended')).rejects.toMatchObject({
          status: 404,
        })
        const recreated = await postCreated('contended', 'new incarnation')
        expect(recreated.createdAt.getTime()).toBeGreaterThan(before.createdAt.getTime())
        expect(recreated.id).toBe(before.id)
        expect(recreated.sourceRefs[0].messageId).not.toBe(before.sourceRefs[0].messageId)
        expect(recreated.data).toEqual([{ role: 'assistant', content: 'new incarnation' }])
        expect((await nativeTimes('contended')).createdAt).toBe(physical.createdAt)
      } finally {
        capturedDelete.mockRestore()
        nativeDelete.mockRestore()
      }
    }
  )
  caseIt(
    'E3',
    'preserves an orphan and a genuinely recreated owner without launching native deletion',
    async () => {
      const absentOwner = `memory-orphan-${randomUUID()}`
      const identity = await seed('orphan', 2, absentOwner)
      const nativeDelete = vi.spyOn(store, 'deleteThread')
      try {
        await expect(cleanupOrphanWorkflowMemory(workspaceId, absentOwner)).rejects.toThrow(
          'deferred'
        )
        let next = 0
        let deferredOwners = 0
        for (;;) {
          const page = await cleanupOrphanWorkflowMemoryPage(next)
          expect(page.removed).toBe(0)
          deferredOwners += page.deferredOwners
          if (!page.hasMore) break
          expect(page.nextPage).toBeGreaterThan(next)
          next = page.nextPage
        }
        expect(deferredOwners).toBe(1)
        expect(nativeDelete).not.toHaveBeenCalled()
        expect(
          (await store.listMessages({ ...identity, page: 0, perPage: 100 })).messages
        ).toHaveLength(2)
        await createWorkflow(absentOwner)
        expect(await cleanupOrphanWorkflowMemory(workspaceId, absentOwner)).toBe(0)
        await appendWorkflowMemory(auth, absentOwner, 'orphan', {
          role: 'assistant',
          content: 'new owner exact message',
        })
        expect((await getWorkflowMemory(auth, absentOwner, 'orphan')).data).toEqual([
          { role: 'system', content: ' 0🔥\n' },
          { role: 'user', content: ' 1🔥\n' },
          { role: 'assistant', content: 'new owner exact message' },
        ])
        expect(nativeDelete).not.toHaveBeenCalled()
      } finally {
        nativeDelete.mockRestore()
      }
    }
  )
  caseIt(
    'E4',
    'never starts a destructive native call after a delayed owner read loses its actual application holder',
    async () => {
      const key = 'delete-holder-loss'
      const identity = await seed(key, 2)
      const entered = deferred()
      const release = deferred()
      const original = memory.getThreadById.bind(memory)
      let paused = false
      let operationId: number | undefined
      const lookup = vi.spyOn(memory, 'getThreadById').mockImplementation(async (args) => {
        const value = await original(args)
        if (args.threadId === identity.threadId && !paused) {
          paused = true
          operationId = context.getStore()?.operationId
          entered.resolve()
          await release.promise
        }
        return value
      })
      const nativeDelete = vi.spyOn(store, 'deleteThread')
      const messageDelete = vi.spyOn(store, 'deleteMessages')
      const deleting = outcomeOf(deleteWorkflowMemory(auth, workflowId, key))
      try {
        await requiredStage(entered, deleting, 'E4 owner lookup')
        const target = await actualHolder(key, operationId)
        await terminateHolder(control, input, target.captured, workspaceId, workflowId, key)
        await appendWorkflowMemory(auth, workflowId, key, {
          role: 'user',
          content: 'after holder loss',
        })
        release.resolve()
        expect((await deleting).ok).toBe(false)
        expect(messageDelete).not.toHaveBeenCalled()
        expect(nativeDelete).not.toHaveBeenCalled()
        expect((await getWorkflowMemory(auth, workflowId, key)).data).toEqual([
          { role: 'system', content: ' 0🔥\n' },
          { role: 'user', content: ' 1🔥\n' },
          { role: 'user', content: 'after holder loss' },
        ])
      } finally {
        release.resolve()
        await deleting
        expect(await drain(4000, true)).toBe(true)
        lookup.mockRestore()
        messageDelete.mockRestore()
        nativeDelete.mockRestore()
      }
    }
  )
  caseIt(
    'E5',
    'Get All returns at most50 complete current keys and discards the whole buffer when a later candidate disappears',
    async () => {
      for (let i = 0; i < 51; i++)
        await seed(`all-${String(i).padStart(2, '0')}`, i === 3 ? 201 : 1)
      const result = await getAllWorkflowMemory(auth, workflowId)
      expect(result).toHaveLength(50)
      expect(new Set(result.map(({ key }) => key)).size).toBe(50)
      expect(result.find(({ key }) => key === 'long')?.data).toHaveLength(2001)
      expect(result.find(({ key }) => key === 'all-03')?.data).toHaveLength(201)
      const original = memory.getThreadById.bind(memory)
      const gone = workflowMemoryIdentity(workspaceId, workflowId, 'all-05').threadId
      const spy = vi
        .spyOn(memory, 'getThreadById')
        .mockImplementation(async (args) => (args.threadId === gone ? null : original(args)))
      try {
        await expect(getAllWorkflowMemory(auth, workflowId)).rejects.toThrow('not found')
      } finally {
        expect(await drain(4000, true)).toBe(true)
        spy.mockRestore()
      }
    }
  )
  caseIt(
    'E6',
    'restores actual saved/encrypted/current-claim checkpoint after Delete404 and fresh-store recreation with original proof',
    async () => {
      const f = checkpointFixture
      const sourceAuth = { success: true, userId: f.actor }
      const record = await getWorkflowMemory(sourceAuth, f.workflow, f.sourceKey)
      expect(record.data).toHaveLength(103)
      const bodyDigest = workflowMessageDigest(record.data)
      const workflow = createMinimalWorkflow()
      const executorContext = {
        ...createMockContext({
          workflow,
          workspaceId: f.workspace,
          workflowId: f.workflow,
        }),
        userId: f.actor,
        executionId: f.executionId,
      }
      const output = { memories: record.data }
      executorContext.blockStates.set('memory', { output, executed: true, executionTime: 1 })
      const executor = finalizeExecutorCheckpoint({
        workflow,
        currentBlockStates: { memory: output },
        context: saveExecutionContext(executorContext),
        iteration: 1,
        finalOutput: output,
      })
      const snapshot: WorkflowCheckpointSnapshot = {
        executor,
        workflowLogId: f.logId,
        workflowInput: {},
        triggerType: 'manual',
        blueprint: {
          workflowId: f.workflow,
          executionTarget: 'live',
          workflowContext: { workspaceId: f.workspace, variables: {} },
          workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
        },
      }
      const saved = await observe('control', 'E6.actual.checkpoint.save', () =>
        saveWorkflowCheckpoint({
          executionId: f.executionId,
          workflowId: f.workflow,
          workspaceId: f.workspace,
          userId: f.actor,
          snapshot,
          pausePoints: [
            {
              id: 'memory-review',
              blockId: 'approval',
              blockName: 'Review exact saved context',
              kind: 'human',
              displayData: {},
              inputFormat: [{ name: 'approved', type: 'boolean', required: true }],
            },
          ],
        })
      )
      expect(saved.revision).toBe(1)
      const [paused] = await database()
        .select()
        .from(workflowExecutionLogs)
        .where(statement`${workflowExecutionLogs.id}=${f.logId}`)
        .limit(1)
      const data = paused.executionData as Record<string, any>
      expect(data.checkpoint.encryptedSnapshot).not.toContain(record.data[1].content)
      const decrypted = await decryptSecret(data.checkpoint.encryptedSnapshot)
      const cold = JSON.parse(decrypted.decrypted)
      expect(cold.executor.workflowMemorySources.version).toBe(2)
      expect(
        getWorkflowMessageSource(cold.executor.currentBlockStates.memory.memories[0])
      ).toBeUndefined()
      const [payloadRow] = await database()
        .select()
        .from(workflowExecutionLogs)
        .where(statement`${workflowExecutionLogs.id}=${f.logId}`)
        .limit(1)
      const payloadData = payloadRow.executionData as Record<string, any>
      if (payloadData.functionalPayload?.threadId)
        scopes.push(payloadData.functionalPayload.threadId)
      const hot = await observe('control', 'E6.actual.checkpoint.hot-read', () =>
        readWorkflowCheckpointSnapshot(f.executionId)
      )
      const hotOutput = hot?.executor.currentBlockStates.memory
      if (
        !hotOutput ||
        typeof hotOutput !== 'object' ||
        !('memories' in hotOutput) ||
        !Array.isArray(hotOutput.memories)
      )
        refuse('Actual hot checkpoint Memory output is unavailable')
      expect(workflowMessageDigest(hotOutput.memories)).toBe(bodyDigest)
      await deleteWorkflowMemory(sourceAuth, f.workflow, f.sourceKey)
      await expect(getWorkflowMemory(sourceAuth, f.workflow, f.sourceKey)).rejects.toMatchObject({
        status: 404,
      })
      expect(await getAllWorkflowMemory(sourceAuth, f.workflow)).toEqual([])
      let fresh: ReturnType<typeof createNativeStorage> | undefined
      try {
        fresh = await observe('control', 'E6.fresh.native.factory', async () =>
          createNativeStorage(input.nativeUrl)
        )
        const freshStore = await observe('delegate', 'E6.fresh.native.memory-domain', () =>
          fresh!.storage.getStore('memory')
        )
        const freshWorkflows = await observe('delegate', 'E6.fresh.native.workflows-domain', () =>
          fresh!.storage.getStore('workflows')
        )
        if (!freshStore || !freshWorkflows) refuse('Actual fresh native domains required')
        const freshMemory = new Memory({ storage: fresh.storage, options: PASSIVE_MEMORY_OPTIONS })
        wrapDomain(freshStore, [
          'getThreadById',
          'listMessages',
          'listMessagesById',
          'saveThread',
          'saveMessages',
          'raiseRunFence',
        ])
        wrapDomain(freshWorkflows, ['getRunOwnership', 'claimRunOwnership'])
        wrapDomain(freshMemory, ['getThreadById', 'listThreads', 'createThread'])
        vi.spyOn(runtime, 'getNativeMemoryStore').mockResolvedValue(freshStore)
        vi.spyOn(runtime, 'getNativeWorkflowsStore').mockResolvedValue(freshWorkflows)
        vi.spyOn(runtime, 'getNativeMemory').mockResolvedValue(freshMemory)
        await expect(getWorkflowMemory(sourceAuth, f.workflow, f.sourceKey)).rejects.toMatchObject({
          status: 404,
        })
        fixture.actorUserId = f.actor
        const { POST } = await import('@/app/api/memory/route')
        const recreatedResponse = await observe('control', 'E6.actual.API.recreate', () =>
          POST(
            new NextRequest('http://fixture.invalid/api/memory', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                type: 'agent',
                workflowId: f.workflow,
                key: f.sourceKey,
                data: { role: record.data[0].role, content: record.data[0].content },
              }),
            })
          )
        )
        expect(recreatedResponse.status).toBe(201)
        const recreated = await getWorkflowMemory(sourceAuth, f.workflow, f.sourceKey)
        expect(recreated.sourceRefs[0].messageId).not.toBe(record.sourceRefs[0].messageId)
        const liveIds = recreated.sourceRefs.map(({ messageId }) => messageId)
        await observe('control', 'E6.actual.checkpoint.submit', () =>
          submitWorkflowCheckpoint({
            executionId: f.executionId,
            workflowId: f.workflow,
            workspaceId: f.workspace,
            revision: saved.revision,
            pausePointId: 'memory-review',
            reviewerId: f.actor,
            input: { approved: true },
          })
        )
        const beforeClaim = known.filter((entry) => entry.kind === 'delegate').length
        expect(
          await claimWorkflowCheckpoint({
            executionId: f.executionId,
            revision: saved.revision + 1,
            jobId: workflowResumeJobId(f.executionId, saved.revision + 1),
          })
        ).toBeNull()
        expect(
          await claimWorkflowCheckpoint({
            executionId: f.executionId,
            revision: saved.revision,
            jobId: 'wrong-job',
          })
        ).toBeNull()
        const claimed = await observe('control', 'E6.actual.checkpoint.cold-claim', () =>
          claimWorkflowCheckpoint({
            executionId: f.executionId,
            revision: saved.revision,
            jobId: workflowResumeJobId(f.executionId, saved.revision),
          })
        )
        expect(claimed).not.toBeNull()
        expect(claimed!.userId).toBe(f.actor)
        expect(claimed!.revision).toBe(saved.revision)
        const coldOutput = claimed!.snapshot.executor.currentBlockStates.memory
        if (
          !coldOutput ||
          typeof coldOutput !== 'object' ||
          !('memories' in coldOutput) ||
          !Array.isArray(coldOutput.memories)
        )
          refuse('Actual cold checkpoint Memory output is unavailable')
        const exact = coldOutput.memories
        expect(exact).toEqual(record.data)
        expect(workflowMessageDigest(exact)).toBe(bodyDigest)
        expect(getWorkflowMessageSource(exact[0])?.messageId).toBe(record.sourceRefs[0].messageId)
        expect(getWorkflowMessageSource(exact[0])?.readProof?.digest).toBe(
          record.sourceRefs[0].digest
        )
        expect(liveIds).not.toContain(getWorkflowMessageSource(exact[0])?.messageId)
        expect(known.filter((entry) => entry.kind === 'delegate')).toHaveLength(beforeClaim)
        const [claimedLog] = await database()
          .select()
          .from(workflowExecutionLogs)
          .where(statement`${workflowExecutionLogs.id}=${f.logId}`)
          .limit(1)
        const claimedData = claimedLog.executionData as Record<string, any>
        expect(claimedData).not.toHaveProperty('pause')
        expect(claimedData.checkpoint.encryptedSnapshot).toBe(data.checkpoint.encryptedSnapshot)
        expect(
          await claimWorkflowCheckpoint({
            executionId: f.executionId,
            revision: saved.revision,
            jobId: workflowResumeJobId(f.executionId, saved.revision),
          })
        ).toBeNull()
      } finally {
        fixture.actorUserId = auth.userId
        if (fresh) await observe('cleanup', 'E6.fresh.native.close', () => fresh!.close(), true)
      }
    }
  )
  caseIt(
    'E7',
    'discards delayed rows after application holder termination and never publishes a prefix',
    async () => {
      const key = 'lost'
      await seed(key, 201)
      const entered = deferred()
      const release = deferred()
      const original = store.listMessages.bind(store)
      let operationId: number | undefined
      const spy = vi.spyOn(store, 'listMessages').mockImplementation(async (args) => {
        const result = await original(args)
        if (
          args.threadId === workflowMemoryIdentity(workspaceId, workflowId, key).threadId &&
          args.page === 1
        ) {
          operationId = context.getStore()?.operationId
          entered.resolve()
          await release.promise
        }
        return result
      })
      const reading = outcomeOf(getWorkflowMemory(auth, workflowId, key))
      try {
        await requiredStage(entered, reading, 'E7 actual second page')
        const target = await actualHolder(key, operationId)
        await terminateHolder(control, input, target.captured, workspaceId, workflowId, key)
        release.resolve()
        expect((await reading).ok).toBe(false)
        expect(spy).toHaveBeenCalledTimes(2)
      } finally {
        release.resolve()
        await reading
        expect(await drain(4000, true)).toBe(true)
        spy.mockRestore()
      }
    }
  )
  caseIt(
    'E8',
    'cancels during a public page await, waits for acknowledgement, and issues no next page',
    async () => {
      await seed('cancel', 201)
      const entered = deferred()
      const release = deferred()
      const original = store.listMessages.bind(store)
      const spy = vi.spyOn(store, 'listMessages').mockImplementation(async (args) => {
        const result = await original(args)
        entered.resolve()
        await release.promise
        return result
      })
      const controller = new AbortController()
      let settled = false
      const reading = getWorkflowMemory(auth, workflowId, 'cancel', controller.signal)
      const result = reading.then(
        () => {
          settled = true
          return true
        },
        () => {
          settled = true
          return false
        }
      )
      try {
        await requiredStage(entered, result, 'E8 actual page')
        controller.abort()
        await Promise.resolve()
        expect(settled).toBe(false)
        release.resolve()
        expect(await result).toBe(false)
        expect(spy).toHaveBeenCalledTimes(1)
      } finally {
        release.resolve()
        await result
        expect(await drain(4000, true)).toBe(true)
        spy.mockRestore()
      }
    }
  )
  async function priorSaveCase(caseId: string, recreate: boolean, ackOnly = false) {
    const key = `prior-save-${caseId}`
    const identity = workflowMemoryIdentity(workspaceId, workflowId, key)
    const before = await getWorkflowMemory(auth, workflowId, key)
    const beforeNative = await nativeTimes(key)
    const entered = deferred()
    const release = deferred()
    const nativeDone = deferred()
    const original = store.saveMessages.bind(store)
    let selected = false
    let operationId: number | undefined
    let oldId = ''
    let actualAttempts = 0
    let commits = 0
    let conflict = false
    const save = vi.spyOn(store, 'saveMessages').mockImplementation(async (args) => {
      if (selected || args.messages[0]?.threadId !== identity.threadId) return original(args)
      selected = true
      operationId = context.getStore()?.operationId
      oldId = args.messages[0].id
      try {
        expect(args.fence).toMatchObject({
          runId: `workflow-memory-ownership:${identity.threadId}`,
          ownerId: expect.any(String),
          generation: expect.any(Number),
        })
        if (!ackOnly) {
          trace('public-save-before-original-delegate', { oldId, sqlAlreadyInFlight: false })
          entered.resolve()
          await release.promise
        }
        actualAttempts++
        let value: Awaited<ReturnType<typeof store.saveMessages>>
        try {
          value = await original(args)
          commits++
        } catch (error) {
          conflict = isRunFenceConflictError(error)
          throw error
        }
        if (ackOnly) {
          const readback = await store.listMessagesById({ messageIds: [oldId] })
          expect(
            readback.messages.some(
              (message) =>
                message.id === oldId &&
                message.threadId === identity.threadId &&
                message.resourceId === identity.resourceId
            )
          ).toBe(true)
          const actualDelegate = known.filter(
            (entry) =>
              entry.operationId === operationId &&
              entry.kind === 'delegate' &&
              entry.method === 'saveMessages'
          )
          expect(actualDelegate).toHaveLength(1)
          expect(actualDelegate[0].outcome).toBe('fulfilled')
          return await observe('control', 'public.SAVE.ack-only.pending', async () => {
            trace('native-original-save-already-completed-before-ack-pause', {
              oldId,
              actualAttempts,
              commits,
              originalDelegateSettled: true,
              wrapperAcknowledgementPending: true,
            })
            entered.resolve()
            await release.promise
            return value
          })
        }
        return value
      } finally {
        nativeDone.resolve()
      }
    })
    const old = outcomeOf(
      appendWorkflowMemory(auth, workflowId, key, {
        role: 'user',
        content: `unacknowledged ${caseId}🔥`,
      })
    )
    let acknowledgedNative = beforeNative
    let expected: Awaited<ReturnType<typeof getWorkflowMemory>> | undefined
    try {
      await requiredStage(entered, old, `${caseId} save pre-delegate gate`)
      const target = await actualHolder(key, operationId)
      await terminateHolder(control, input, target.captured, workspaceId, workflowId, key)
      expect((await old).ok).toBe(false)
      await deleteWorkflowMemory(auth, workflowId, key)
      await expect(getWorkflowMemory(auth, workflowId, key)).rejects.toMatchObject({ status: 404 })
      acknowledgedNative = await nativeTimes(key)
      expect(acknowledgedNative.createdAt).toBe(beforeNative.createdAt)
      expect(acknowledgedNative.updatedAt).toBeGreaterThanOrEqual(beforeNative.updatedAt)
      if (recreate) {
        const created = await postCreated(key, `ACK recreated ${caseId}🔥`)
        expect(created.createdAt.getTime()).toBeGreaterThan(before.createdAt.getTime())
        const later = await appendWorkflowMemory(auth, workflowId, key, {
          role: 'user',
          content: `ACK later ${caseId}🔥`,
        })
        expect(later.created).toBe(false)
        expected = later.record
        expect(expected.createdAt.getTime()).toBe(created.createdAt.getTime())
        expect(expected.sourceRefs.map(({ messageId }) => messageId)).not.toContain(oldId)
        acknowledgedNative = await nativeTimes(key)
        expect(expected.updatedAt.getTime()).toBe(acknowledgedNative.updatedAt)
      }
      const acknowledgedAt = performance.now()
      release.resolve()
      await nativeDone.promise
      expect(await drain(4000, true)).toBe(true)
      expect(actualAttempts).toBe(1)
      expect(commits).toBe(ackOnly ? 1 : 0)
      expect(conflict).toBe(!ackOnly)
      expect((await store.listMessagesById({ messageIds: [oldId] })).messages).toEqual([])
      const finalNative = await nativeTimes(key)
      expect(finalNative).toEqual(acknowledgedNative)
      if (expected) {
        const current = await getWorkflowMemory(auth, workflowId, key)
        expect(current.data).toEqual(expected.data)
        expect(current.sourceRefs).toEqual(expected.sourceRefs)
        expect(current.sourceRefs.every((ref, ordinal) => ref.ordinal === ordinal)).toBe(true)
        expect(current.createdAt.getTime()).toBe(expected.createdAt.getTime())
        expect(current.updatedAt.getTime()).toBe(expected.updatedAt.getTime())
      } else
        await expect(getWorkflowMemory(auth, workflowId, key)).rejects.toMatchObject({
          status: 404,
        })
      trace(
        ackOnly ? 'prior-commit-ack-only-control-completed' : 'late-original-save-actually-refused',
        {
          caseId,
          oldId,
          actualAttempts,
          nativeCommits: commits,
          fenceConflict: conflict,
          ackOnly,
          acknowledgedAt,
          beforeLogical: {
            createdAt: before.createdAt.getTime(),
            updatedAt: before.updatedAt.getTime(),
          },
          beforeNative,
          acknowledgedNative,
          finalNative,
          finalLogical: expected
            ? { createdAt: expected.createdAt.getTime(), updatedAt: expected.updatedAt.getTime() }
            : { status: 404 },
          acknowledgedIds: expected?.sourceRefs.map(({ messageId }) => messageId) ?? [],
        }
      )
    } finally {
      release.resolve()
      if (selected) await nativeDone.promise
      await old
      expect(await drain(4000, true)).toBe(true)
      save.mockRestore()
    }
  }
  caseIt(
    'N1',
    'rejects actual old SAVE after app holder loss and acknowledged logical Delete/Get404',
    async () => {
      await priorSaveCase('N1', false)
    }
  )
  caseIt(
    'N2',
    'retains exact201 recreation/later ACK IDs and logical/native timestamps after original stale SAVE refuses',
    async () => {
      await priorSaveCase('N2', true)
    }
  )
  caseIt(
    'SQL42501',
    'observes actual native INSERT privilege failure through public SAVE and preserves exact prior readback',
    async () => {
      const key = 'actual-query-permission'
      const before = await getWorkflowMemory(auth, workflowId, key)
      const beforeNative = await nativeTimes(key)
      const role = roleIdentifier(input.state.roles.studio_native.name)
      const allowed = async () => {
        await guardControl(control, input)
        const rows = await control.unsafe("SELECT has_table_privilege($1,$2,'INSERT') AS allowed", [
          input.state.roles.studio_native.name,
          messagesTable,
        ])
        if (rows.length !== 1 || typeof rows[0].allowed !== 'boolean')
          refuse('Native INSERT privilege classification unavailable')
        return rows[0].allowed
      }
      expect(await allowed()).toBe(true)
      let revoked = false
      let observed42501 = false
      try {
        await guardControl(control, input)
        await control.unsafe(`REVOKE INSERT ON TABLE ${messagesTable} FROM ${role}`)
        revoked = true
        if (await allowed())
          refuse('INSERT remains inherited; fault stage unexecuted, no new grant or role')
        const failed = await outcomeOf(
          appendWorkflowMemory(auth, workflowId, key, {
            role: 'assistant',
            content: 'must fail actual INSERT',
          })
        )
        expect(failed.ok).toBe(false)
        if (!failed.ok) observed42501 = hasSqlState(failed.error, '42501')
        expect(observed42501).toBe(true)
        expect(await drain(4000, true)).toBe(true)
      } finally {
        // No ACL restoration while an actual admitted callback/native query is unresolved.
        const settled = await drain(4000, true)
        if (!settled) {
          closeAdmissions('SQL42501-known-call-unresolved')
          refuse('Native fault operation has not settled; restoration deferred')
        }
        if (revoked) {
          await observe(
            'cleanup',
            'restore-original-native-INSERT',
            async () => {
              await guardControl(control, input, true)
              await control.unsafe(`GRANT INSERT ON TABLE ${messagesTable} TO ${role}`)
            },
            true
          )
        }
      }
      expect(await allowed()).toBe(true)
      const after = await getWorkflowMemory(auth, workflowId, key)
      expect(after.data).toEqual(before.data)
      expect(after.sourceRefs).toEqual(before.sourceRefs)
      expect(after.createdAt.getTime()).toBe(before.createdAt.getTime())
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
      expect(await nativeTimes(key)).toEqual(beforeNative)
      trace('actual-native-sql-failure', {
        sqlState: '42501',
        observed42501,
        changedMessages: false,
        restoredAfterKnownSettlement: true,
      })
    }
  )
  caseIt(
    'SQLINFLIGHT',
    'orders a witnessed in-flight native INSERT before newer raise and Delete ACK, with no post-ACK effect',
    async () => {
      const key = 'actual-sql-inflight'
      const identity = workflowMemoryIdentity(workspaceId, workflowId, key)
      const before = await getWorkflowMemory(auth, workflowId, key)
      const beforeNative = await nativeTimes(key)
      const saveEntered = deferred()
      const releaseSave = deferred()
      const originalSaveDone = deferred()
      const tableLocked = deferred()
      const releaseTable = deferred()
      const originalSave = store.saveMessages.bind(store)
      const originalRaise = store.raiseRunFence.bind(store)
      let selected = false
      let oldOperationId: number | undefined
      let oldId = ''
      let originalCommitted = false
      let raising = false
      let raiseSettled = false
      let oldFence: RunFence | undefined
      let bound: ControlSql | undefined
      let tableTask: Promise<unknown> | undefined
      const save = vi.spyOn(store, 'saveMessages').mockImplementation(async (args) => {
        if (selected || args.messages[0]?.threadId !== identity.threadId) return originalSave(args)
        selected = true
        oldOperationId = context.getStore()?.operationId
        oldId = args.messages[0].id
        oldFence = args.fence
        saveEntered.resolve()
        try {
          await releaseSave.promise
          const result = await originalSave(args)
          originalCommitted = true
          return result
        } finally {
          originalSaveDone.resolve()
        }
      })
      const raise = vi.spyOn(store, 'raiseRunFence').mockImplementation(async (fence) => {
        if (oldFence && fence.runId === oldFence.runId && fence.generation > oldFence.generation) {
          raising = true
          try {
            return await originalRaise(fence)
          } finally {
            raiseSettled = true
          }
        }
        return originalRaise(fence)
      })
      const deleteMessages = vi.spyOn(store, 'deleteMessages')
      const old = outcomeOf(
        appendWorkflowMemory(auth, workflowId, key, {
          role: 'user',
          content: 'actual native SQL pending🔥',
        })
      )
      let deleting: ReturnType<typeof outcomeOf<void>> | undefined
      let oldNativeBackend: Backend | undefined
      let waiter: Backend | undefined
      try {
        await requiredStage(
          saveEntered,
          old,
          'SQLINFLIGHT public pre-delegate boundary after prior reads'
        )
        const oldCallback = currentCallback(oldOperationId)
        const releaseBy = Math.min(oldCallback.enteredAt + 2500, input.workEnds - 500)
        if (performance.now() + 1000 >= releaseBy)
          refuse('Unchanged holder budget cannot accommodate actual fault witness')
        // Only now lock messages: doing so before the pre-delegate stage would block Add's SELECT.
        tableTask = observe('control', 'messages.ACCESS_EXCLUSIVE', () =>
          control.begin((connection) =>
            observe('callback', 'operator.transaction.callback', async () => {
              await guardControl(connection, input)
              await connection.unsafe("SET LOCAL lock_timeout='500ms'")
              await guardControl(connection, input)
              await connection.unsafe(`LOCK TABLE ${messagesTable} IN ACCESS EXCLUSIVE MODE`)
              bound = connection
              tableLocked.resolve()
              try {
                await releaseTable.promise
              } finally {
                bound = undefined
              }
            })
          )
        )
        await requiredStage(tableLocked, tableTask, 'SQLINFLIGHT actual table lock')
        const connection = bound ?? refuse('Bound SAME max1 control transaction unavailable')
        releaseSave.resolve()
        const nativePid = await poll(
          async () => {
            await guardControl(connection, input)
            await connection.unsafe('SELECT pg_stat_clear_snapshot()')
            const rows = await connection.unsafe(
              `SELECT a.pid FROM pg_stat_activity a
          JOIN pg_locks l ON l.pid=a.pid WHERE a.datname=$1 AND a.usename=$2 AND a.xact_start IS NOT NULL
          AND l.relation=to_regclass($3) AND l.mode='RowExclusiveLock' AND NOT l.granted`,
              [input.state.database, input.state.roles.studio_native.name, messagesTable]
            )
            if (rows.length > 1) refuse('Ambiguous native SQL witness')
            return rows.length === 1 && Number.isSafeInteger(rows[0].pid)
              ? Number(rows[0].pid)
              : undefined
          },
          Math.min(performance.now() + 600, releaseBy - 600),
          'original native INSERT waiting on TABLE_MESSAGES'
        )
        const capturedNativeBackend = await backend(connection, input, nativePid, 'studio_native')
        oldNativeBackend = capturedNativeBackend
        const holder = await actualHolder(key, oldOperationId, connection)
        await terminateHolder(connection, input, holder.captured, workspaceId, workflowId, key)
        expect((await old).ok).toBe(false)
        deleting = outcomeOf(deleteWorkflowMemory(auth, workflowId, key))
        const waiterPid = await poll(
          async () => {
            if (!raising || raiseSettled) return undefined
            await guardControl(connection, input)
            await connection.unsafe('SELECT pg_stat_clear_snapshot()')
            const rows = await connection.unsafe(
              `SELECT a.pid FROM pg_stat_activity a WHERE a.datname=$1
          AND a.usename=$2 AND a.pid<>$3 AND a.xact_start IS NOT NULL AND a.wait_event_type='Lock'
          AND $3=ANY(pg_blocking_pids(a.pid)) AND EXISTS (SELECT 1 FROM pg_stat_activity old
            WHERE old.pid=$3 AND old.datname=$1 AND old.usename=$2
            AND old.backend_start::text=$4 AND old.xact_start::text=$5)`,
              [
                input.state.database,
                input.state.roles.studio_native.name,
                nativePid,
                capturedNativeBackend.backendStart,
                capturedNativeBackend.xactStart,
              ]
            )
            if (rows.length > 1) refuse('Ambiguous newer raise witness')
            return rows.length === 1 && Number.isSafeInteger(rows[0].pid)
              ? Number(rows[0].pid)
              : undefined
          },
          Math.min(performance.now() + 600, releaseBy - 100),
          'newer Memory.raise waiting on actual old native transaction'
        )
        waiter = await backend(connection, input, waiterPid, 'studio_native')
        expect(raiseSettled).toBe(false)
        expect(performance.now()).toBeLessThan(releaseBy)
        trace('actual-native-inflight-and-raise-witness', {
          oldNativePid: oldNativeBackend.pid,
          newerRaisePid: waiter.pid,
          oldAppPid: holder.captured.pid,
          releaseBy,
          table: TABLE_MESSAGES,
          queryKind: 'public SAVE RowExclusiveLock',
        })
        releaseTable.resolve()
        await tableTask
        const result = await deleting
        expect(result.ok).toBe(true)
        const deleteAckAt = performance.now()
        // Actual complete Delete captured the prior SAVE ID: its mutation preceded this ACK,
        // independent of when the older public SAVE acknowledgement continuation is scheduled.
        expect(deleteMessages.mock.calls.some(([ids]) => ids.includes(oldId))).toBe(true)
        await expect(getWorkflowMemory(auth, workflowId, key)).rejects.toMatchObject({
          status: 404,
        })
        const deletedNative = await nativeTimes(key)
        expect(deletedNative.createdAt).toBe(beforeNative.createdAt)
        expect(deletedNative.updatedAt).toBeGreaterThanOrEqual(beforeNative.updatedAt)
        const recreated = await postCreated(key, 'ACK recreation after actual SQL')
        expect(recreated.createdAt.getTime()).toBeGreaterThan(before.createdAt.getTime())
        const later = await appendWorkflowMemory(auth, workflowId, key, {
          role: 'user',
          content: 'ACK later after actual SQL',
        })
        expect(later.created).toBe(false)
        const acknowledgedNative = await nativeTimes(key)
        await originalSaveDone.promise
        await old
        expect(await drain(4000, true)).toBe(true)
        expect(originalCommitted).toBe(true)
        expect(raiseSettled).toBe(true)
        const final = await getWorkflowMemory(auth, workflowId, key)
        expect(final.data).toEqual(later.record.data)
        expect(final.sourceRefs).toEqual(later.record.sourceRefs)
        expect(final.sourceRefs.every((ref, ordinal) => ref.ordinal === ordinal)).toBe(true)
        expect(final.sourceRefs.map(({ messageId }) => messageId)).not.toContain(oldId)
        expect(final.createdAt.getTime()).toBe(later.record.createdAt.getTime())
        expect(final.updatedAt.getTime()).toBe(later.record.updatedAt.getTime())
        expect(await nativeTimes(key)).toEqual(acknowledgedNative)
        expect((await store.listMessagesById({ messageIds: [oldId] })).messages).toEqual([])
        trace('actual-inflight-save-before-delete-ack', {
          oldId,
          deleteAckAt,
          capturedOldId: true,
          oldNativePid: oldNativeBackend.pid,
          newerRaisePid: waiter.pid,
          originalCommitted,
          beforeLogical: {
            createdAt: before.createdAt.getTime(),
            updatedAt: before.updatedAt.getTime(),
          },
          beforeNative,
          acknowledgedLogical: {
            createdAt: later.record.createdAt.getTime(),
            updatedAt: later.record.updatedAt.getTime(),
          },
          acknowledgedNative,
        })
      } finally {
        releaseSave.resolve()
        releaseTable.resolve()
        if (tableTask) await outcomeOf(tableTask)
        if (selected) await originalSaveDone.promise
        await old
        if (deleting) await deleting
        expect(await drain(4000, true)).toBe(true)
        save.mockRestore()
        raise.mockRestore()
        deleteMessages.mockRestore()
      }
    }
  )
  caseIt(
    'E9',
    'returns exact first50 logical keys beyond empty containers and preserves literal empty text as one entry',
    async () => {
      expect(orderingLive).toHaveLength(51)
      const recreated = await postCreated(
        'old-empty-container',
        'born after candidate51',
        orderingWorkflow
      )
      expect(recreated.createdAt.getTime()).toBeGreaterThan(
        Math.max(...orderingLive.map(({ createdAt }) => createdAt))
      )
      expect((await nativeTimes('old-empty-container', orderingWorkflow)).createdAt).toBe(
        oldOrderingContainerCreatedAt
      )
      const empty = await postCreated('literal-empty-entry', '', orderingWorkflow)
      expect(empty.data).toEqual([{ role: 'assistant', content: '' }])
      expect(empty.sourceRefs).toHaveLength(1)
      expect((await getWorkflowMemory(auth, orderingWorkflow, 'literal-empty-entry')).data).toEqual(
        [{ role: 'assistant', content: '' }]
      )
      const expected = [...orderingLive]
        .sort((a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .slice(0, 50)
      const actual = await getAllWorkflowMemory(auth, orderingWorkflow)
      expect(actual.map(({ key, createdAt }) => ({ key, createdAt: createdAt.getTime() }))).toEqual(
        expected
      )
      expect(actual).toHaveLength(50)
      expect(actual.every(({ data }) => data.length === 1)).toBe(true)
      expect(
        actual.some(
          ({ key }) => key.startsWith('empty-container-') || key === 'old-empty-container'
        )
      ).toBe(false)
      trace('actual-logical-first50', {
        emptyContainers: 52,
        capturedLiveCandidates: orderingLive.length,
        oldContainerCreatedAt: oldOrderingContainerCreatedAt,
        recreatedLogicalCreatedAt: recreated.createdAt.getTime(),
        literalEmptyMessageCount: empty.data.length,
        expectedKeys: expected.map(({ key }) => key),
      })
    }
  )
  caseIt(
    'R8CAP',
    'selects50 confirmed live keys before complete histories and never contacts the excluded long history',
    async () => {
      const excluded = workflowMemoryIdentity(workspaceId, capWorkflow, 'live-50')
      const original = store.listMessages.bind(store)
      const pages = vi.spyOn(store, 'listMessages').mockImplementation(async (args) => {
        if (args.threadId === excluded.threadId && args.perPage !== 1)
          throw new Error('Excluded complete history must never be dispatched')
        return original(args)
      })
      try {
        const result = await getAllWorkflowMemory(auth, capWorkflow)
        expect(result.map(({ key }) => key)).toEqual(
          [...capLive]
            .sort(
              (a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
            )
            .slice(0, 50)
            .map(({ key }) => key)
        )
        expect(result.every(({ data }) => data.length === 1)).toBe(true)
        expect(pages.mock.calls.filter(([args]) => args.perPage === 100)).toHaveLength(50)
        expect(pages.mock.calls.filter(([args]) => args.threadId === excluded.threadId)).toEqual([
          [expect.objectContaining({ perPage: 1 })],
        ])
        trace('excluded-complete-history-not-dispatched', {
          excludedThreadId: excluded.threadId,
          actualExcludedMessages: 201,
          completeHistories: 50,
          presenceOnly: true,
        })
      } finally {
        expect(await drain(4000, true)).toBe(true)
        pages.mockRestore()
      }
    }
  )
  caseIt(
    'R8GONE',
    'fails the complete selected buffer after key50 is deleted without hydrating or refilling from key51',
    async () => {
      const victim = [...capLive].sort(
        (a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      )[49]
      const excluded = workflowMemoryIdentity(workspaceId, capWorkflow, 'live-50')
      const entered = deferred()
      const release = deferred()
      const original = database().transaction.bind(database())
      let transactions = 0
      const pages = vi.spyOn(store, 'listMessages')
      const transaction = vi.spyOn(database(), 'transaction').mockImplementation((run, config) => {
        const facade = known.find((entry) => entry.sequence === context.getStore()?.operationId)
        if (facade?.method === 'getAll' && ++transactions === 51)
          return observe('control', 'getAll.selected50.before-entry', async () => {
            expect(pages.mock.calls.filter(([args]) => args.perPage === 100)).toHaveLength(49)
            entered.resolve()
            await release.promise
            return original(run, config)
          })
        return original(run, config)
      })
      const listing = outcomeOf(getAllWorkflowMemory(auth, capWorkflow))
      try {
        await requiredStage(entered, listing, 'selected key50 before hydration')
        expect(await deleteWorkflowMemory(auth, capWorkflow, victim.key)).toBeUndefined()
        await expect(getWorkflowMemory(auth, capWorkflow, victim.key)).rejects.toMatchObject({
          status: 404,
        })
        release.resolve()
        const result = await listing
        expect(result.ok).toBe(false)
        if (result.ok) throw new Error('Missing selected key returned a partial/refilled buffer')
        expect(result.error).toMatchObject({ status: 404 })
        expect(pages.mock.calls.filter(([args]) => args.threadId === excluded.threadId)).toEqual([
          [expect.objectContaining({ perPage: 1 })],
        ])
        trace('selected50-gone-no-refill', {
          selectedKey: victim.key,
          bufferedKeys: 49,
          excludedThreadId: excluded.threadId,
        })
      } finally {
        release.resolve()
        await listing
        expect(await drain(4000, true)).toBe(true)
        transaction.mockRestore()
        pages.mockRestore()
      }
    }
  )
  caseIt(
    'R7BASELINE',
    'holds the actual discovered key hierarchy through acknowledged native presence and excludes Delete contact',
    async () => {
      const owner = `memory-baseline-${randomUUID()}`
      await createWorkflow(owner)
      const identity = await seed('baseline', 1, owner)
      const entered = deferred()
      const release = deferred()
      const original = store.listMessages.bind(store)
      const pages = vi.spyOn(store, 'listMessages').mockImplementation(async (args) => {
        const result = await original(args)
        if (args.threadId === identity.threadId && args.perPage === 1) {
          entered.resolve()
          await release.promise
        }
        return result
      })
      const mutation = vi.spyOn(store, 'deleteMessages')
      const reading = outcomeOf(getAllWorkflowMemory(auth, owner))
      const cancel = new AbortController()
      let deleting: ReturnType<typeof outcomeOf<void>> | undefined
      try {
        await requiredStage(entered, reading, 'R7 acknowledged presence before projection')
        deleting = outcomeOf(deleteWorkflowMemory(auth, owner, 'baseline', cancel.signal))
        await observe('control', 'baseline.actual-lock-wait', async () => {
          const until = performance.now() + 200
          for (;;) {
            const rows = await control.unsafe(
              `SELECT count(*)::int AS waiting FROM pg_stat_activity
              WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock'`,
              [input.state.database, input.state.roles.studio_app.name]
            )
            if (rows[0]?.waiting > 0) break
            if (performance.now() >= until) refuse('Actual waiting Delete holder not observed')
            await new Promise((resolve) => setTimeout(resolve, 1))
          }
        })
        expect(mutation).not.toHaveBeenCalled()
        cancel.abort()
        release.resolve()
        const result = await reading
        expect(result.ok).toBe(true)
        if (!result.ok) throw result.error
        expect(result.value.map(({ key }) => key)).toEqual(['baseline'])
        expect((await deleting).ok).toBe(false)
        expect(mutation).not.toHaveBeenCalled()
        trace('baseline-held-through-native-presence', {
          actualDeleteWait: true,
          destructiveCalls: 0,
        })
      } finally {
        cancel.abort()
        release.resolve()
        await reading
        if (deleting) await deleting
        expect(await drain(4000, true)).toBe(true)
        pages.mockRestore()
        mutation.mockRestore()
      }
    }
  )
  for (const recreate of [false, true])
    caseIt(
      recreate ? 'R7RECREATE' : 'R7GONE',
      recreate
        ? 'GetAll can bind the complete recreated current conversation after live selection'
        : 'GetAll rejects its whole buffered prefix after acknowledged logical Delete retains an empty container',
      async () => {
        const owner = `memory-logical-selection-${randomUUID()}`
        await createWorkflow(owner)
        await seed('a-buffered', 1, owner)
        const victim = await seed('b-victim', 1, owner)
        const before = await nativeTimes('b-victim', owner)
        const entered = deferred()
        const release = deferred()
        const original = database().transaction.bind(database())
        let transactions = 0
        let buffered = false
        const page = store.listMessages.bind(store)
        const pages = vi.spyOn(store, 'listMessages').mockImplementation(async (args) => {
          const result = await page(args)
          if (
            args.threadId === workflowMemoryIdentity(workspaceId, owner, 'a-buffered').threadId &&
            args.perPage === 100
          )
            buffered = true
          return result
        })
        const transaction = vi
          .spyOn(database(), 'transaction')
          .mockImplementation((run, config) => {
            const active = context.getStore()
            const facade = known.find((entry) => entry.sequence === active?.operationId)
            if (facade?.method === 'getAll' && ++transactions === 3)
              return observe('control', 'getAll.later-hydration.before-entry', async () => {
                expect(buffered).toBe(true)
                entered.resolve()
                await release.promise
                return original(run, config)
              })
            return original(run, config)
          })
        const listing = outcomeOf(getAllWorkflowMemory(auth, owner))
        try {
          await requiredStage(entered, listing, 'R7 later hydration before transaction entry')
          expect(await deleteWorkflowMemory(auth, owner, 'b-victim')).toBeUndefined()
          await expect(getWorkflowMemory(auth, owner, 'b-victim')).rejects.toMatchObject({
            status: 404,
          })
          const empty = await store.listMessages({
            ...victim,
            page: 0,
            perPage: 100,
            includeTotal: true,
            orderBy: { field: 'createdAt', direction: 'ASC' },
          })
          expect(empty.total).toBe(0)
          expect(empty.messages).toEqual([])
          const deleted = await nativeTimes('b-victim', owner)
          expect(deleted.createdAt).toBe(before.createdAt)
          trace('acknowledged-logical-deletion-after-live-selection', {
            bufferedPrefix: true,
            retainedThreadId: victim.threadId,
            entriesAfterDelete: empty.total,
            before,
            deleted,
          })
          const replacement = recreate ? await postCreated('b-victim', '', owner) : undefined
          release.resolve()
          const result = await listing
          if (replacement) {
            expect(result.ok).toBe(true)
            if (!result.ok) throw result.error
            expect(result.value.map(({ key }) => key)).toEqual(['a-buffered', 'b-victim'])
            expect(result.value[1].data).toEqual([{ role: 'assistant', content: '' }])
            expect(result.value[1].sourceRefs).toEqual(replacement.sourceRefs)
            expect(result.value[1].createdAt).toEqual(replacement.createdAt)
          } else {
            expect(result.ok).toBe(false)
            if (result.ok) throw new Error('Missing selected logical key produced a partial buffer')
            expect(result.error).toMatchObject({ status: 404 })
          }
        } finally {
          release.resolve()
          await listing
          expect(await drain(4000, true)).toBe(true)
          transaction.mockRestore()
          pages.mockRestore()
        }
      }
    )
  caseIt(
    'N3',
    'preserves ACKed recreation after an actually committed original SAVE delays only its acknowledgement',
    async () => {
      await priorSaveCase('N3', true, true)
    }
  )
})
