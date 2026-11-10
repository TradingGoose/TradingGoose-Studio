/** @vitest-environment node */
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { basename, dirname, isAbsolute, resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { FinancialBinding } from '@/lib/billing/native-finance'
import type { TraceSpan } from '@/lib/logs/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { ArchiveReference } from './format'

// The sole module seam points BOTH real server IO and real private-source classification
// at one owned local directory. Auth/storage/quota/DB/finance remain actual modules.
const localIO = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/local-path', () => ({
  get UPLOAD_DIR_SERVER() {
    if (!localIO.root) throw new Error('Owned local upload root must precede application imports')
    return localIO.root
  },
}))

// Same established NEW-owned source fixture guard, before importing any application client.
function sourceFixture() {
  const statePath = process.env.SOURCE_BILLING_TEST_STATE_FILE
  if (!statePath) return null
  const refuse = (): never => {
    throw new Error('Explicit NEW owned canonical preservation fixture required')
  }
  if (
    process.env.FIXTURE_MUTATION_OPT_IN !== 'r15-v1-fresh-disposable' ||
    !isAbsolute(statePath) ||
    resolve(statePath) !== statePath ||
    realpathSync(statePath) !== statePath ||
    basename(statePath) !== 'state.json' ||
    !/^db-private-[a-z0-9]+$/.test(basename(dirname(statePath)))
  )
    refuse()
  const st = lstatSync(statePath)
  const parent = lstatSync(dirname(statePath))
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
    realpathSync(dirname(statePath)) !== dirname(statePath)
  )
    refuse()
  const bytes = readFileSync(statePath)
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    process.env.SOURCE_BILLING_TEST_STATE_SHA256
  )
    refuse()
  const role = z.object({ name: z.string(), password: z.string().min(1) })
  const state = z
    .object({
      version: z.literal('r15-v1'),
      stage: z.literal('ready'),
      smoke: z.unknown().optional(),
      statePath: z.string(),
      id: z.string().regex(/^[a-f0-9]{16}$/),
      database: z.string(),
      marker: z.string().regex(/^r15-v1:[a-f0-9]{48}$/),
      operator: z.string(),
      roles: z.object({ owner: role, studio_app: role, studio_native: role }),
      actors: z
        .array(z.object({ userId: z.string().min(1), workspaceId: z.string().min(1) }))
        .min(1),
    })
    .parse(JSON.parse(bytes.toString('utf8')))
  const input = new URL(process.env.DATABASE_URL ?? '')
  const operator = new URL(state.operator)
  const native = new URL(process.env.MASTRA_DATABASE_URL ?? '')
  const nativeOwner = new URL(process.env.MASTRA_OWNER_DATABASE_URL ?? '')
  if (
    state.smoke ||
    state.statePath !== statePath ||
    state.database !== `r15_${state.id}` ||
    !['postgres:', 'postgresql:'].includes(input.protocol) ||
    input.protocol !== operator.protocol ||
    input.hostname !== '127.0.0.1' ||
    operator.hostname !== '127.0.0.1' ||
    !input.port ||
    input.port !== operator.port ||
    input.pathname !== `/${state.database}` ||
    input.search ||
    input.hash ||
    state.roles.studio_app.name !== `r15_${state.id}_studio_app` ||
    input.username !== state.roles.studio_app.name ||
    input.password !== state.roles.studio_app.password ||
    native.protocol !== operator.protocol ||
    native.hostname !== input.hostname ||
    native.port !== input.port ||
    native.pathname !== input.pathname ||
    native.search ||
    native.hash ||
    native.username !== state.roles.studio_native.name ||
    native.password !== state.roles.studio_native.password ||
    nativeOwner.protocol !== operator.protocol ||
    nativeOwner.hostname !== input.hostname ||
    nativeOwner.port !== input.port ||
    nativeOwner.pathname !== input.pathname ||
    nativeOwner.search ||
    nativeOwner.hash ||
    nativeOwner.username !== state.roles.owner.name ||
    nativeOwner.password !== state.roles.owner.password ||
    Object.keys(process.env).some((key) => key.startsWith('PG') && process.env[key])
  )
    refuse()
  return {
    database: state.database,
    marker: state.marker,
    appRole: state.roles.studio_app.name,
    actors: state.actors,
    nativeOwnerUrl: nativeOwner.href,
  }
}
const owned = sourceFixture()
const suite = owned ? describe : describe.skip
let db: typeof import('@tradinggoose/db').db
let tables: typeof import('@tradinggoose/db/schema')
let finance: typeof import('@/lib/billing/native-finance')
let verify: typeof import('@/lib/logs/execution/financial-acceptance').verifyWorkflowFinancialAcceptance
let lifecycle: typeof import('./lifecycle')
let readers: typeof import('@/lib/execution/workflow-execution-events')
let archiveIO: typeof import('./io')
let format: typeof import('./format')
let historical: typeof import('./historical')
let outputSentinel: typeof import('./functional').FUNCTIONAL_OUTPUT_REFERENCE
let authorizeRetained: typeof import('./functional').assertRetainedLogAccess
let Executor: typeof import('@/executor').Executor
let VariablesBlockHandler: typeof import('@/executor/handlers/variables/variables-handler').VariablesBlockHandler
let buildTraceSpans: typeof import('@/lib/logs/execution/trace-spans/trace-spans').buildTraceSpans
let projectFunctionalBlocks: typeof import('./functional').projectFunctionalBlocks
let hydrateFunctionalBlocks: typeof import('./functional').hydrateFunctionalBlocks
let hydrateAuthorizedLog: typeof import('./functional').hydrateAuthorizedLog
let nativeHistory: typeof import('@/lib/mastra/workflow-history')
let nativeRuntime: typeof import('@/lib/mastra/runtime')
let ExecutionLogger: typeof import('@/lib/logs/execution/logger').ExecutionLogger
let setupWork: Promise<void> | undefined
let setupOutcome: 'not-started' | 'running' | 'fulfilled' | 'rejected' = 'not-started'
let setupLastStage = 'not-started'
let occurrenceWork: Promise<void> | undefined
let occurrenceOutcome: 'not-started' | 'running' | 'fulfilled' | 'rejected' = 'not-started'
let occurrenceLastStage = 'not-started'
let privateRoot = ''
let ownedTempRoot = ''
let workspaceFiles: typeof import('@/lib/uploads/contexts/workspace/workspace-file-manager')
let fileProcessing: typeof import('@/lib/uploads/utils/file-processing')
let storageService: typeof import('@/lib/uploads/core/storage-service')
let readBoundary: typeof import('@/lib/uploads/source-read-boundary')
let fileLogger: ReturnType<typeof import('@/lib/logs/console/logger').createLogger>
let contacts = 0
type Log = typeof import('@tradinggoose/db/schema').workflowExecutionLogs.$inferSelect
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const dataOf = (row: Log) => {
  if (!object(row.executionData)) throw new Error('Actual fixture log data missing')
  return row.executionData
}
async function readLog(id: string) {
  const [row] = await db
    .select()
    .from(tables.workflowExecutionLogs)
    .where(eq(tables.workflowExecutionLogs.id, id))
    .limit(1)
  if (!row) throw new Error('Actual fixture owning log missing')
  return row
}
async function original(
  mode: 'accepted' | 'unaccepted' | 'absent',
  failed = false,
  active = false
) {
  if (!owned) throw new Error('Owned state unavailable')
  const actor = owned.actors[0]
  if (!actor) throw new Error('Canonical original actor missing')
  const workspaceId = randomUUID()
  const workflowId = randomUUID()
  const snapshotId = randomUUID()
  const logId = randomUUID()
  const executionId = randomUUID()
  const at = new Date()
  await db.insert(tables.workspace).values({
    id: workspaceId,
    name: 'Owned preservation case',
    ownerId: actor.userId,
    billingOwnerType: 'user',
    billingOwnerUserId: actor.userId,
  })
  await db.insert(tables.workflow).values({
    id: workflowId,
    userId: actor.userId,
    workspaceId,
    name: 'Owned preservation workflow',
    lastSynced: at,
    createdAt: at,
    updatedAt: at,
  })
  await db.insert(tables.workflowExecutionSnapshots).values({
    id: snapshotId,
    workflowId,
    workspaceId,
    stateHash: `original:${snapshotId}`,
    stateData: { blocks: {}, edges: [], loops: {}, parallels: {} },
  })
  let binding: FinancialBinding | undefined
  let appliedUsd: string | undefined
  if (mode !== 'absent') {
    binding = await finance.createFinancialInvocation({
      actorUserId: actor.userId,
      workspaceId,
      workflowId,
      purpose: 'workflow-execution',
      runId: executionId,
      operationKey: executionId,
      quotedHoldUsd: '0.1',
    })
    await finance.admitFinancialModelStep(binding, {
      stepNumber: 0,
      retryCount: 0,
      runId: executionId,
    })
    if (mode === 'accepted' && !active) {
      const receipt = await finance.acceptFinancialBusinessOperation(binding, {
        executionTrigger: 'manual',
      })
      expect(receipt.recordType).toBe('operation')
      expect(receipt.contactState).toBe('accepted')
      expect(receipt.holdState).toBe('closed')
      expect(typeof receipt.appliedUsd).toBe('string')
      appliedUsd = receipt.appliedUsd
    }
  }
  const output = {
    exact: ' original🔥\n ',
    toolResults: [{ original: true, tokens: 'business tokens', cost: 'business cost' }],
  }
  const spans: TraceSpan[] = [
    {
      id: `source:${logId}`,
      blockId: 'original-agent',
      name: 'Original agent',
      type: 'agent',
      duration: 1,
      startTime: at.toISOString(),
      endTime: at.toISOString(),
      input: { messages: [{ role: 'system', content: ' exact source🔥\n ' }] },
      output,
    },
  ]
  const executionData = {
    environment: { userId: actor.userId, workflowId, workspaceId, executionId },
    ...(binding ? { billing: { binding } } : {}),
    ...(!active ? { traceSpans: spans, finalOutput: output, hasResponseBlock: true } : {}),
    ...(failed ? { errorMessage: 'original execution failed' } : {}),
    trigger: {
      data: {
        queuedExecution: { source: 'workflow_execute_api', originalRequest: `request:${logId}` },
      },
    },
  }
  await db.insert(tables.workflowExecutionLogs).values({
    id: logId,
    workflowId,
    workspaceId,
    executionId,
    stateSnapshotId: snapshotId,
    workflowSummary: { id: workflowId, name: 'Original retained workflow' },
    level: failed ? 'error' : 'info',
    trigger: 'manual',
    startedAt: at,
    endedAt: active ? null : at,
    totalDurationMs: 1,
    executionData,
  })
  const row = await readLog(logId)
  if (mode === 'accepted' && !active)
    expect(await verify(row)).toMatchObject({ accepted: true, appliedUsd })
  return { row, output, spans, actor, binding, appliedUsd }
}
async function protectedSource(source: { record: Log; snapshot: unknown }) {
  // Private source backup is independent of the runtime archive reference and kept until owned cleanup.
  await writeFile(
    path.join(privateRoot, `protected-${source.record.id}.json`),
    JSON.stringify(source),
    { mode: 0o600, flag: 'wx' }
  )
}
async function archiveFilename(ref: ArchiveReference) {
  const filename = path.resolve(privateRoot, ref.key)
  if (!filename.startsWith(privateRoot + path.sep))
    throw new Error('Fixture archive escaped owned private root')
  return filename
}
suite('historical preservation through REAL original finance and current scoped readers', () => {
  beforeAll(() => {
    const began = performance.now()
    const stage = (name: string) => {
      setupLastStage = name
      console.info(
        'R12_OCCURRENCE_SETUP_STAGE ' +
          JSON.stringify({ stage: name, elapsedMs: performance.now() - began })
      )
    }
    setupOutcome = 'running'
    setupLastStage = 'registered'
    setupWork = Promise.resolve()
      .then(async () => {
        stage('owned-setup-start')
        if (!owned) throw new Error('Owned fixture missing')
        ownedTempRoot = await mkdtemp(path.join(tmpdir(), 'preservation-financial-'))
        privateRoot = path.join(ownedTempRoot, 'archives')
        localIO.root = path.join(ownedTempRoot, 'uploads')
        await Promise.all([
          mkdir(privateRoot, { mode: 0o700 }),
          mkdir(localIO.root, { mode: 0o700 }),
        ])
        stage('owned-directories-complete')
        vi.stubEnv('STORAGE_PROVIDER', 'local')
        vi.stubEnv('WORKFLOW_ARCHIVE_PROVIDER', 'local')
        vi.stubEnv('WORKFLOW_ARCHIVE_PRIVATE_VERIFIED', 'true')
        vi.stubEnv('WORKFLOW_ARCHIVE_LOCAL_ROOT', privateRoot)
        vi.stubEnv('WORKFLOW_ADMISSIONS_CLOSED', 'true')
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => {
            contacts++
            throw new Error('No network belongs to preserved result validation')
          })
        )
        stage('app-import-start')
        ;({ db } = await import('@tradinggoose/db'))
        tables = await import('@tradinggoose/db/schema')
        const [actual] = await db.execute(
          sql`SELECT current_database() AS database, current_user AS role, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname=current_database()`
        )
        expect(actual).toMatchObject({
          database: owned.database,
          marker: owned.marker,
          role: owned.appRole,
        })
        stage('app-owner-check-complete')
        finance = await import('@/lib/billing/native-finance')
        if (!finance.financialSchedulerReady())
          throw new Error('Actual canonical source scheduler-ready/CRON fixture settings required')
        const policy = await import('@tradinggoose/billing')
        await policy.assertFinancialStorageReady(db)
        stage('financial-readiness-complete')
        ;({ verifyWorkflowFinancialAcceptance: verify } = await import(
          '@/lib/logs/execution/financial-acceptance'
        ))
        format = await import('./format')
        archiveIO = await import('./io')
        historical = await import('./historical')
        ;({
          FUNCTIONAL_OUTPUT_REFERENCE: outputSentinel,
          assertRetainedLogAccess: authorizeRetained,
        } = await import('./functional'))
        readers = await import('@/lib/execution/workflow-execution-events')
        lifecycle = await import('./lifecycle')
        stage('reader-imports-complete')
        nativeRuntime = await import('@/lib/mastra/runtime')
        const initializer = nativeRuntime.createNativeStorage(owned.nativeOwnerUrl, true)
        stage('native-init-start')
        try {
          await initializer.storage.init()
        } finally {
          await initializer.close()
        }
        stage('native-init-and-close-complete')
        workspaceFiles = await import('@/lib/uploads/contexts/workspace/workspace-file-manager')
        fileProcessing = await import('@/lib/uploads/utils/file-processing')
        storageService = await import('@/lib/uploads/core/storage-service')
        readBoundary = await import('@/lib/uploads/source-read-boundary')
        fileLogger = (await import('@/lib/logs/console/logger')).createLogger(
          'OwnedCanonicalWorkspaceFile'
        )
        const setup = await import('@/lib/uploads/core/setup.server')
        expect(setup.UPLOAD_DIR_SERVER).toBe(localIO.root)
        expect(await setup.ensureUploadsDirectory()).toBe(true)
        stage('upload-setup-complete')
        // Shared module loading belongs to this existing owned setup budget, with the real clock.
        stage('shared-preload-start')
        ;({ Executor } = await import('@/executor'))
        ;({ VariablesBlockHandler } = await import(
          '@/executor/handlers/variables/variables-handler'
        ))
        ;({ buildTraceSpans } = await import('@/lib/logs/execution/trace-spans/trace-spans'))
        ;({ projectFunctionalBlocks, hydrateFunctionalBlocks, hydrateAuthorizedLog } = await import(
          './functional'
        ))
        nativeHistory = await import('@/lib/mastra/workflow-history')
        ;({ ExecutionLogger } = await import('@/lib/logs/execution/logger'))
        stage('setup-complete')
      })
      .then(
        () => {
          setupOutcome = 'fulfilled'
          console.info(
            'R12_OCCURRENCE_SETUP_SETTLED ' +
              JSON.stringify({ outcome: setupOutcome, lastStage: setupLastStage })
          )
        },
        (error: unknown) => {
          setupOutcome = 'rejected'
          console.info(
            'R12_OCCURRENCE_SETUP_SETTLED ' +
              JSON.stringify({ outcome: setupOutcome, lastStage: setupLastStage })
          )
          throw error
        }
      )
    console.info('R12_OCCURRENCE_SETUP_REGISTERED ' + JSON.stringify({ registered: true }))
    return setupWork
  }, 60000)
  afterAll(async () => {
    const errors: unknown[] = []
    let setupWait: 'not-started' | 'fulfilled' | 'rejected' = 'not-started'
    let bodyWait: 'not-started' | 'fulfilled' | 'rejected' = 'not-started'
    try {
      if (setupWork) {
        const [outcome] = await Promise.allSettled([setupWork])
        setupWait = outcome.status
        if (outcome.status === 'rejected') errors.push(outcome.reason)
      }
      if (occurrenceWork) {
        const [outcome] = await Promise.allSettled([occurrenceWork])
        bodyWait = outcome.status
        if (outcome.status === 'rejected') errors.push(outcome.reason)
      }
      try {
        expect(setupOutcome).not.toBe('running')
        expect(occurrenceOutcome).not.toBe('running')
        expect(contacts).toBe(0)
      } catch (error) {
        errors.push(error)
      }
    } finally {
      // Hanging known setup/body can exhaust this existing hook before closes are observed.
      // Independent known close attempts are recorded only after both actual known waits.
      const closed = await Promise.allSettled([
        import('@/lib/mastra/runtime').then(({ closeNativeRuntime }) => closeNativeRuntime()),
        Promise.resolve().then(() => (db ? db.$client.end({ timeout: 2 }) : undefined)),
        Promise.resolve().then(() =>
          ownedTempRoot ? rm(ownedTempRoot, { recursive: true, force: true }) : undefined
        ),
      ])
      console.info(
        'R12_OCCURRENCE_RESOURCES_CLOSED ' +
          JSON.stringify({
            setupOutcome,
            setupWait,
            setupLastStage,
            bodyOutcome: occurrenceOutcome,
            bodyWait,
            lastStage: occurrenceLastStage,
            native: closed[0].status,
            app: closed[1].status,
            io: closed[2].status,
            appAttempted: Boolean(db),
            ioAttempted: Boolean(ownedTempRoot),
          })
      )
      for (const result of closed) if (result.status === 'rejected') errors.push(result.reason)
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1)
      throw new AggregateError(errors, 'Owned preservation fixture assertion or cleanup failed')
  }, 20000)
  it.each([false, true])(
    'preserves exact actual-reader authority and original finance (failed=%s)',
    async (failed) => {
      const f = await original('accepted', failed)
      const reference = await lifecycle.preserveHistoricalWorkflowPayload(f.row.id, protectedSource)
      const retained = await readLog(f.row.id)
      const data = dataOf(retained)
      expect(data.billing).toEqual(dataOf(f.row).billing)
      expect(data.environment).toEqual(dataOf(f.row).environment)
      expect(data).not.toHaveProperty('traceSpans')
      expect(data.finalOutput).toEqual(outputSentinel)
      const authorize = () =>
        authorizeRetained(
          {
            workspaceId: retained.workspaceId,
            executionId: retained.executionId!,
            logId: retained.id,
          },
          f.actor.userId
        )
      const result = await readers.readWorkflowExecutionResultFromLog(retained, authorize)
      expect(result.status).toBe(failed ? 'failed' : 'completed') // Actual reader is the outcome authority.
      expect(result.result).toMatchObject({
        success: !failed,
        output: f.output,
        metadata: {
          hasResponseBlock: true,
          queuedExecution: { originalRequest: `request:${f.row.id}` },
        },
      })
      if (failed) expect(result.failureReason).toBe('original execution failed')
      const shared = await readers.readVerifiedWorkflowExecutionData(retained, authorize)
      expect(shared).toMatchObject({
        finalOutput: f.output,
        environment: data.environment,
        billing: data.billing,
      })
      expect(await verify(retained)).toMatchObject({ accepted: true, appliedUsd: f.appliedUsd })
      expect(
        await lifecycle.preserveHistoricalWorkflowPayload(retained.id, async () => {
          throw new Error('Existing reference must not repeat source protection')
        })
      ).toEqual(reference)
      expect(await readLog(f.row.id)).toEqual(retained)
    }
  )
  it('retains real equal-time Executor occurrences through native completion, Records and authorized archive reads', () => {
    const began = performance.now()
    const stage = (name: string) => {
      occurrenceLastStage = name
      console.info(
        'R12_OCCURRENCE_STAGE ' +
          JSON.stringify({ stage: name, elapsedMs: performance.now() - began })
      )
    }
    occurrenceOutcome = 'running'
    occurrenceLastStage = 'registered'
    occurrenceWork = Promise.resolve()
      .then(async () => {
        stage('original-start')
        const f = await original('accepted', false, true)
        stage('original-complete')
        const executionId = f.row.executionId
        const workflowId = f.row.workflowId
        if (!f.binding || !executionId || !workflowId)
          throw new Error('Actual admitted original execution is required')
        const makeBlock = (
          id: string,
          type: string,
          params: Record<string, unknown> = {}
        ): SerializedBlock => ({
          id,
          position: { x: 0, y: 0 },
          enabled: true,
          inputs: {},
          outputs: {},
          config: { tool: type, params },
          metadata: {
            id: type,
            name: id,
            ...(type === 'input_trigger' ? { category: 'triggers' } : {}),
          },
        })
        const workflow: SerializedWorkflow = {
          version: '1.0',
          blocks: [
            makeBlock('trigger', 'input_trigger'),
            makeBlock('loop', 'loop'),
            makeBlock('values', 'variables', {
              variables: [
                {
                  variableId: 'v',
                  variableName: 'iteration',
                  type: 'number',
                  value: '<loop.index>',
                },
              ],
            }),
          ],
          connections: [
            { source: 'trigger', target: 'loop' },
            { source: 'loop', target: 'values', sourceHandle: 'loop-start-source' },
            { source: 'values', target: 'loop', targetHandle: 'loop-end-target' },
          ],
          loops: { loop: { id: 'loop', nodes: ['values'], iterations: 3, loopType: 'for' } },
          parallels: {},
        }
        const variableRuns = vi.spyOn(VariablesBlockHandler.prototype, 'execute')
        stage('native-store-start')
        const store = await nativeRuntime.getNativeMemoryStore()
        stage('native-store-complete')
        const writes = vi.spyOn(store, 'saveMessages')
        const payloadWrites = vi.spyOn(nativeHistory, 'writeFunctionalPayload')
        try {
          const executor = new Executor({
            workflow,
            workflowVariables: { v: { name: 'iteration', type: 'number', value: -1 } },
            contextExtensions: {
              workspaceId: f.row.workspaceId,
              userId: f.actor.userId,
              executionId,
              workflowLogId: f.row.id,
            },
          })
          const at = new Date()
          // Freeze Date only around this actual Executor call; later native/finance/archive IO uses the real clock.
          stage('executor-start')
          vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(at)
          let executed: Awaited<ReturnType<InstanceType<typeof Executor>['execute']>>
          try {
            executed = await executor.execute(workflowId, 'trigger')
          } finally {
            vi.useRealTimers()
          }
          stage('executor-complete')
          expect(executed.success).toBe(true)
          expect(variableRuns).toHaveBeenCalledTimes(3)
          const values = (executed.logs ?? []).filter(({ blockId }) => blockId === 'values')
          expect(values.map(({ output }) => output)).toEqual([
            { iteration: 0 },
            { iteration: 1 },
            { iteration: 2 },
          ])
          expect(new Set(values.map(({ startedAt }) => startedAt)).size).toBe(1)
          expect(new Set(executed.logs?.map(({ id }) => id)).size).toBe(executed.logs?.length)
          const spans = buildTraceSpans(executed).traceSpans
          const expected = projectFunctionalBlocks(spans)
          stage('projection-start')
          const expectedHydrated = await hydrateFunctionalBlocks(expected)
          stage('projection-complete')
          expect(
            expected
              .filter(({ blockId }) => blockId === 'values')
              .map(({ id, output }) => ({ id, output }))
          ).toEqual(values.map(({ id, output }) => ({ id, output })))
          expect(projectFunctionalBlocks(buildTraceSpans(executed).traceSpans)).toEqual(expected)
          const logger = new ExecutionLogger()
          const complete = {
            executionId,
            workflowLogId: f.row.id,
            workspaceId: f.row.workspaceId,
            endedAt: new Date().toISOString(),
            totalDurationMs: executed.metadata?.duration ?? 0,
            finalOutput: executed.output,
            success: executed.success,
            traceSpans: spans,
          }
          stage('completion-start')
          await logger.completeWorkflowExecution(complete)
          stage('completion-complete')
          const terminal = await readLog(f.row.id)
          const accepted = await verify(terminal)
          stage('terminal-finance-read-complete')
          expect(accepted).toMatchObject({ accepted: true, appliedUsd: expect.any(String) })
          expect(dataOf(terminal).billing).toEqual({ binding: f.binding, billable: true })
          const produced = payloadWrites.mock.results[0]
          if (!produced || produced.type !== 'return')
            throw new Error('Actual completed canonical writer return is required')
          const canonical = await produced.value
          expect(dataOf(terminal).functionalPayload).toEqual(canonical)
          // The typed current reference is taken from the actual completed return, never guessed.
          stage('records-read-start')
          const completedData = await readers.readVerifiedWorkflowExecutionData(terminal, () =>
            authorizeRetained(
              { workspaceId: terminal.workspaceId, executionId, logId: terminal.id },
              f.actor.userId
            )
          )
          stage('records-read-complete')
          expect(object(completedData) && completedData.traceSpans).toEqual(expectedHydrated)
          stage('native-payload-read-start')
          const nativeData = await nativeHistory.readFunctionalPayload(canonical)
          stage('native-payload-read-complete')
          expect(nativeData.blocks).toEqual(expected)
          const nativeWrites = writes.mock.calls.length
          expect(nativeWrites).toBe(1)
          stage('hot-read-start')
          const hot = await hydrateAuthorizedLog(terminal, f.actor.userId)
          stage('hot-read-complete')
          expect(dataOf(hot).traceSpans).toEqual(expectedHydrated)
          stage('repeat-completion-start')
          await logger.completeWorkflowExecution(complete)
          stage('repeat-completion-complete')
          expect(writes).toHaveBeenCalledTimes(nativeWrites)
          expect(await verify(await readLog(f.row.id))).toEqual(accepted)
          expect(variableRuns).toHaveBeenCalledTimes(3)
          stage('archive-prepare-start')
          const reference = await lifecycle.prepareWorkflowArchive(f.row.id)
          stage('archive-prepare-complete')
          const archiveBytes = await readFile(await archiveFilename(reference))
          stage('archive-bytes-read-complete')
          const retained = await readLog(f.row.id)
          expect(dataOf(retained).functionalPayload).toEqual(canonical)
          const nativeRead = vi.spyOn(nativeHistory, 'readFunctionalPayload')
          const privateRead = vi.spyOn(archiveIO, 'readPrivateArchive')
          try {
            stage('archive-hydrate-start')
            const cold = await hydrateAuthorizedLog(retained, f.actor.userId)
            stage('archive-hydrate-complete')
            expect(dataOf(cold).traceSpans).toEqual(expectedHydrated)
            stage('durable-result-read-start')
            const durable = await readers.readWorkflowExecutionResultFromLog(retained, () =>
              authorizeRetained(
                { workspaceId: retained.workspaceId, executionId, logId: retained.id },
                f.actor.userId
              )
            )
            stage('durable-result-read-complete')
            expect(durable.status).toBe('completed')
            expect(durable.result).toMatchObject({ output: executed.output })
            expect(privateRead).toHaveBeenCalled()
            expect(nativeRead).not.toHaveBeenCalled() // Actual workflowArchive reader priority.
          } finally {
            nativeRead.mockRestore()
            privateRead.mockRestore()
          }
          stage('prune-defer-start')
          await expect(lifecycle.pruneArchivedWorkflowPayload(f.row.id)).rejects.toBeInstanceOf(
            lifecycle.ArchivePruneDeferredError
          )
          stage('prune-defer-complete')
          expect(await readLog(f.row.id)).toEqual(retained)
          expect(await readFile(await archiveFilename(reference))).toEqual(archiveBytes)
          stage('final-readback-start')
          expect((await nativeHistory.readFunctionalPayload(canonical)).blocks).toEqual(expected)
          expect(await verify(await readLog(f.row.id))).toEqual(accepted)
          expect(variableRuns).toHaveBeenCalledTimes(3)
          expect(writes).toHaveBeenCalledTimes(nativeWrites)
          stage('final-readback-complete')
        } finally {
          vi.useRealTimers()
          payloadWrites.mockRestore()
          writes.mockRestore()
          variableRuns.mockRestore()
        }
        stage('body-complete')
      })
      .then(
        () => {
          occurrenceOutcome = 'fulfilled'
          console.info(
            'R12_OCCURRENCE_SETTLED ' +
              JSON.stringify({ outcome: occurrenceOutcome, lastStage: occurrenceLastStage })
          )
        },
        (error: unknown) => {
          occurrenceOutcome = 'rejected'
          console.info(
            'R12_OCCURRENCE_SETTLED ' +
              JSON.stringify({ outcome: occurrenceOutcome, lastStage: occurrenceLastStage })
          )
          throw error
        }
      )
    console.info('R12_OCCURRENCE_REGISTERED ' + JSON.stringify({ registered: true }))
    return occurrenceWork
  })
  it('pins absent original finance without activating a reference or changing inline/control bytes', async () => {
    const f = await original('absent')
    const before = await readLog(f.row.id)
    await expect(
      lifecycle.preserveHistoricalWorkflowPayload(f.row.id, protectedSource)
    ).rejects.toThrow('Original workflow financial binding')
    expect(await readLog(f.row.id)).toEqual(before)
    expect(dataOf(await readLog(f.row.id))).not.toHaveProperty('preservedFunctionalArchive')
  })
  it('rechecks actual original actor access on the existing-reference path and retains its private object', async () => {
    const f = await original('accepted')
    const reference = await lifecycle.preserveHistoricalWorkflowPayload(f.row.id, protectedSource)
    const retained = await readLog(f.row.id)
    const beforeBytes = await readFile(await archiveFilename(reference))
    const other = owned?.actors.find((actor) => actor.userId !== f.actor.userId)
    if (!other)
      throw new Error('Canonical second actor required for isolated permission-revocation fixture')
    const predicate = and(
      eq(tables.permissions.entityType, 'workspace'),
      eq(tables.permissions.entityId, f.row.workspaceId),
      eq(tables.permissions.userId, f.actor.userId)
    )
    const permissions = await db.select().from(tables.permissions).where(predicate)
    try {
      await finance.withFinancialRootMutation(
        [{ type: 'user', id: f.actor.userId }],
        async (tx) => {
          await tx.delete(tables.permissions).where(predicate)
          await tx
            .update(tables.workspace)
            .set({ ownerId: other.userId })
            .where(eq(tables.workspace.id, f.row.workspaceId))
        }
      )
      await expect(
        lifecycle.preserveHistoricalWorkflowPayload(f.row.id, async () => {})
      ).rejects.toThrow(/access.*revoked/i)
      expect(await readLog(f.row.id)).toEqual(retained)
      expect(await readFile(await archiveFilename(reference))).toEqual(beforeBytes)
    } finally {
      await finance.withFinancialRootMutation(
        [{ type: 'user', id: f.actor.userId }],
        async (tx) => {
          await tx
            .update(tables.workspace)
            .set({ ownerId: f.actor.userId })
            .where(eq(tables.workspace.id, f.row.workspaceId))
          if (permissions.length) await tx.insert(tables.permissions).values(permissions)
        }
      )
    }
  })
  it('refuses a sourceFingerprint race after real future-readback without stripping the changed source', async () => {
    const f = await original('accepted')
    const changed = { ...dataOf(f.row), actualConcurrentRevision: 'changed during protected IO' }
    await expect(
      lifecycle.preserveHistoricalWorkflowPayload(f.row.id, async (source) => {
        await protectedSource(source)
        await db
          .update(tables.workflowExecutionLogs)
          .set({ executionData: changed })
          .where(eq(tables.workflowExecutionLogs.id, f.row.id))
      })
    ).rejects.toThrow(/source revision changed/i)
    const retained = dataOf(await readLog(f.row.id))
    expect(retained).toEqual(changed)
    expect(retained).not.toHaveProperty('preservedFunctionalArchive')
    expect(retained.traceSpans).toEqual(f.spans)
    expect(retained.finalOutput).toEqual(f.output)
  })
  it('refuses corrupt NEW-owned private bytes on existing reference without replacing or deleting source control', async () => {
    const f = await original('accepted')
    const reference = await lifecycle.preserveHistoricalWorkflowPayload(f.row.id, protectedSource)
    const retained = await readLog(f.row.id)
    const filename = await archiveFilename(reference)
    const bytes = await readFile(filename)
    try {
      // Isolated fault in this fixture's newly created object; never an issued/production artifact.
      await writeFile(filename, Buffer.concat([bytes, Buffer.from('corrupt-new-owned-fixture')]))
      await expect(
        lifecycle.preserveHistoricalWorkflowPayload(f.row.id, async () => {})
      ).rejects.toThrow(/digest mismatch/)
      expect(await readLog(f.row.id)).toEqual(retained)
    } finally {
      await writeFile(filename, bytes)
    }
  })
  it('refuses an actual unaccepted original occurrence even on a controlled old unsafe-reference fixture', async () => {
    const f = await original('unaccepted')
    const gate = await verify(f.row).then(
      () => {
        throw new Error('Unaccepted original unexpectedly verified')
      },
      (error: unknown) => error
    )
    if (!(gate instanceof Error)) throw new Error('Actual original financial refusal required')
    await expect(
      lifecycle.preserveHistoricalWorkflowPayload(f.row.id, protectedSource)
    ).rejects.toThrow(gate.message)
    expect(await readLog(f.row.id)).toEqual(f.row)
    const [snapshot] = await db
      .select()
      .from(tables.workflowExecutionSnapshots)
      .where(eq(tables.workflowExecutionSnapshots.id, f.row.stateSnapshotId))
      .limit(1)
    const data = dataOf(f.row)
    const {
      traceSpans: _trace,
      tokenBreakdown: _tokens,
      models: _models,
      finalOutput: _output,
      functionalPayload: _native,
      nativePayloads: _refs,
      workflowArchive: _archive,
      preservedFunctionalArchive: _preserved,
      ...control
    } = data
    const sentinel = outputSentinel
    const artifact = {
      record: { ...f.row, cost: null, executionData: { ...control, finalOutput: sentinel } },
      snapshot,
      functional: historical.projectHistoricalFunctionalPayload(f.spans, f.output),
      nativeThreads: [],
      sourceFingerprint: format.functionalDigest({
        ...f.row,
        executionData: { ...data, workflowArchive: undefined },
      }),
    }
    const reference = await archiveIO.writePrivateArchive(
      { workspaceId: f.row.workspaceId, executionId: f.row.executionId!, logId: f.row.id },
      artifact
    )
    // Negative fixture of the old unsafe activation, not a product preservation success or fabricated receipt.
    await db
      .update(tables.workflowExecutionLogs)
      .set({
        cost: null,
        executionData: { ...control, preservedFunctionalArchive: reference, finalOutput: sentinel },
      })
      .where(eq(tables.workflowExecutionLogs.id, f.row.id))
    const unsafeExisting = await readLog(f.row.id)
    await expect(
      lifecycle.preserveHistoricalWorkflowPayload(f.row.id, async () => {})
    ).rejects.toThrow(gate.message)
    expect(await readLog(f.row.id)).toEqual(unsafeExisting)
    expect(await readFile(await archiveFilename(reference))).not.toHaveLength(0)
    // Do not accept/replay/release this genuinely unaccepted occurrence to make cleanup pass.
  })
  it('uploads an actual personal-workspace canonical row and enforces exact read scope/purpose with real local bytes', async () => {
    const actor = owned?.actors[0]
    const denied = owned?.actors.find((candidate) => candidate.userId !== actor?.userId)
    if (!actor || !denied)
      throw new Error('Canonical original and independent denied actors required')
    const [personal] = await db
      .select()
      .from(tables.workspace)
      .where(eq(tables.workspace.id, actor.workspaceId))
      .limit(1)
    expect(personal).toMatchObject({ ownerId: actor.userId, billingOwnerType: 'user' })
    const bytesA = Buffer.from(' actual canonical workspace bytes🔥\n ')
    const bytesB = Buffer.from(' distinct second canonical bytes ')
    const fileA = await workspaceFiles.uploadWorkspaceFile(
      actor.workspaceId,
      actor.userId,
      bytesA,
      `source-${randomUUID()}.txt`,
      'text/plain'
    )
    const fileB = await workspaceFiles.uploadWorkspaceFile(
      actor.workspaceId,
      actor.userId,
      bytesB,
      `other-${randomUUID()}.txt`,
      'text/plain'
    )
    if (!fileA.url || !fileA.key || !fileB.url || !fileB.key)
      throw new Error('Actual canonical upload descriptors required')
    const keyA = fileA.key
    const keyB = fileB.key
    const authority = {
      actorUserId: actor.userId,
      workspaceId: actor.workspaceId,
      signal: new AbortController().signal,
    }
    const [row] = await db
      .select()
      .from(tables.workspaceFile)
      .where(
        and(
          eq(tables.workspaceFile.id, fileA.id),
          eq(tables.workspaceFile.workspaceId, actor.workspaceId)
        )
      )
      .limit(1)
    expect(row).toMatchObject({
      id: fileA.id,
      key: keyA,
      uploadedBy: actor.userId,
      size: bytesA.length,
      type: 'text/plain',
    })
    const canonical = await workspaceFiles.resolveAuthorizedWorkspaceFileReference(
      fileA.url,
      actor.userId
    )
    expect(canonical).toMatchObject({ id: fileA.id, key: keyA, workspaceId: actor.workspaceId })
    expect(
      await fileProcessing.downloadFileFromStorage(
        fileA,
        'owned-actual-read',
        fileLogger,
        authority
      )
    ).toEqual(bytesA)
    const wrongKey = `${keyA}-not-canonical`
    const changedKey = new URL(fileA.url, 'http://fixture.invalid')
    changedKey.pathname = `/api/files/serve/${encodeURIComponent(wrongKey)}`
    const wrongScope = new URL(fileA.url, 'http://fixture.invalid')
    wrongScope.searchParams.set('workspaceId', denied.workspaceId)
    const cases = [
      { file: { ...fileA, id: 'wrong-file-id' }, auth: authority },
      {
        file: { ...fileA, key: wrongKey, url: changedKey.pathname + changedKey.search },
        auth: authority,
      },
      { file: { ...fileA, url: wrongScope.pathname + wrongScope.search }, auth: authority },
      { file: fileA, auth: { ...authority, workspaceId: denied.workspaceId } },
      { file: { ...fileA, url: `${fileA.url}&context=workspace` }, auth: authority },
      { file: fileA, auth: { ...authority, actorUserId: denied.userId } },
    ]
    for (const sample of cases)
      await expect(
        fileProcessing.downloadFileFromStorage(
          sample.file,
          'owned-denied-read',
          fileLogger,
          sample.auth
        )
      ).rejects.toMatchObject({ status: 403 })
    if (!canonical) throw new Error('Actual fresh canonical row required before read-grant control')
    await expect(
      readBoundary.withAuthorizedStorageRead(canonical.key, 'workspace', () =>
        storageService.downloadFile({ key: keyB, context: 'workspace', signal: authority.signal })
      )
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      readBoundary.withAuthorizedStorageRead(canonical.key, 'workspace', () =>
        storageService.deleteFile({ key: keyA, context: 'workspace' })
      )
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      storageService.downloadFile({ key: keyA, context: 'workspace', signal: authority.signal })
    ).rejects.toMatchObject({ status: 403 })
    expect(await readFile(path.join(localIO.root, keyA))).toEqual(bytesA)
    expect(await readFile(path.join(localIO.root, keyB))).toEqual(bytesB)
    const [retained] = await db
      .select()
      .from(tables.workspaceFile)
      .where(eq(tables.workspaceFile.id, fileA.id))
      .limit(1)
    expect(retained).toEqual(row)
  })
  it('denies actual canonical row deletion and fresh owner revocation while retaining owned file bytes', async () => {
    const actor = owned?.actors[0]
    const other = owned?.actors.find((candidate) => candidate.userId !== actor?.userId)
    if (!actor || !other) throw new Error('Canonical original and independent actors required')
    const bytes = Buffer.from(' row and membership guarded actual bytes ')
    const deleted = await workspaceFiles.uploadWorkspaceFile(
      actor.workspaceId,
      actor.userId,
      bytes,
      `deleted-row-${randomUUID()}.txt`,
      'text/plain'
    )
    const revoked = await workspaceFiles.uploadWorkspaceFile(
      actor.workspaceId,
      actor.userId,
      bytes,
      `revoked-owner-${randomUUID()}.txt`,
      'text/plain'
    )
    if (!deleted.key || !revoked.key) throw new Error('Actual uploaded file keys required')
    const authority = {
      actorUserId: actor.userId,
      workspaceId: actor.workspaceId,
      signal: new AbortController().signal,
    }
    await db
      .delete(tables.workspaceFile)
      .where(
        and(
          eq(tables.workspaceFile.id, deleted.id),
          eq(tables.workspaceFile.workspaceId, actor.workspaceId)
        )
      )
    await expect(
      fileProcessing.downloadFileFromStorage(
        deleted,
        'deleted-canonical-row',
        fileLogger,
        authority
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(await readFile(path.join(localIO.root, deleted.key))).toEqual(bytes)
    const predicate = and(
      eq(tables.permissions.entityType, 'workspace'),
      eq(tables.permissions.entityId, actor.workspaceId),
      eq(tables.permissions.userId, actor.userId)
    )
    const originalPermissions = await db.select().from(tables.permissions).where(predicate)
    try {
      await finance.withFinancialRootMutation([{ type: 'user', id: actor.userId }], async (tx) => {
        await tx.delete(tables.permissions).where(predicate)
        await tx
          .update(tables.workspace)
          .set({ ownerId: other.userId })
          .where(eq(tables.workspace.id, actor.workspaceId))
      })
      await expect(
        fileProcessing.downloadFileFromStorage(
          revoked,
          'revoked-workspace-owner',
          fileLogger,
          authority
        )
      ).rejects.toMatchObject({ status: 403 })
      const [stillPresent] = await db
        .select()
        .from(tables.workspaceFile)
        .where(eq(tables.workspaceFile.id, revoked.id))
        .limit(1)
      expect(stillPresent?.key).toBe(revoked.key)
      expect(await readFile(path.join(localIO.root, revoked.key))).toEqual(bytes)
    } finally {
      await finance.withFinancialRootMutation([{ type: 'user', id: actor.userId }], async (tx) => {
        await tx
          .update(tables.workspace)
          .set({ ownerId: actor.userId })
          .where(eq(tables.workspace.id, actor.workspaceId))
        if (originalPermissions.length)
          await tx.insert(tables.permissions).values(originalPermissions)
      })
    }
  })
})
