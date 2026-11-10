/** @vitest-environment node */
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { stripe as stripePlugin } from '@better-auth/stripe'
import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { createTool } from '@mastra/core/tools'
import * as policy from '@tradinggoose/billing'
import { centsToProviderNumber } from '@tradinggoose/billing/money'
import * as tables from '@tradinggoose/db/schema'
import { betterAuth } from 'better-auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { organization as organizationPlugin } from 'better-auth/plugins'
import { and, eq, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import * as currentBuiltPolicy from '../../../../packages/billing/dist/index.js'

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string } },
  providerActor: null as string | null,
  visionAuth: null as null | {
    success: boolean
    userId: string
    workspaceId?: string
    authType: string
  },
  visionModel: null as unknown,
  deliveryRender: null as null | (() => Promise<string>),
  captureDrain: null as null | typeof policy.drainFinancialDispatch,
  providerHandler: null as
    | null
    | ((input: {
        body: { workflowId?: string; workspaceId?: string }
        authUserId?: string
        requestId: string
      }) => Promise<Response>),
}))
vi.mock('@tradinggoose/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tradinggoose/billing')>()
  return {
    ...actual,
    drainFinancialDispatch: (...args: Parameters<typeof actual.drainFinancialDispatch>) =>
      (state.captureDrain ?? actual.drainFinancialDispatch)(...args),
  }
})
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => state.session) }))
vi.mock('@/lib/workspaces/service', () => ({
  createDefaultWorkspaceForUser: vi.fn(() => {
    throw new Error('No sign-up or auth provisioning belongs to this fixture')
  }),
  grantWorkspaceAccessInTx: vi.fn(() => {
    throw new Error('No linked workspace invitation belongs to this fixture')
  }),
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: vi.fn(async () => state.visionAuth ?? { success: false }),
  checkSessionOrInternalAuth: vi.fn(async () => ({
    success: Boolean(state.providerActor),
    userId: state.providerActor,
  })),
}))
vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: () => {
    if (!state.visionModel) throw new Error('No source-fixture model configured')
    return state.visionModel
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))
vi.mock('@/lib/uploads/utils/file-processing', () => ({
  downloadFileFromStorage: () => {
    throw new Error('No image storage contact belongs to this fixture')
  },
  processSingleFileToUserFile: () => {
    throw new Error('No image upload belongs to this fixture')
  },
}))
vi.mock('@/components/emails/render-email', async (original) => {
  const actual = await original<typeof import('@/components/emails/render-email')>()
  return {
    ...actual,
    renderUsageThresholdEmail: (...args: Parameters<typeof actual.renderUsageThresholdEmail>) =>
      state.deliveryRender ? state.deliveryRender() : actual.renderUsageThresholdEmail(...args),
    renderPaymentFailedEmail: (...args: Parameters<typeof actual.renderPaymentFailedEmail>) =>
      state.deliveryRender ? state.deliveryRender() : actual.renderPaymentFailedEmail(...args),
    renderFreeTierUpgradeEmail: (...args: Parameters<typeof actual.renderFreeTierUpgradeEmail>) =>
      state.deliveryRender ? state.deliveryRender() : actual.renderFreeTierUpgradeEmail(...args),
  }
})
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: vi.fn(() => {
    throw new Error('Unexpected market credential path in AI scope fixture')
  }),
  credentialAuthStatus: () => 401,
}))
vi.mock('@/app/api/providers/ai/handler', () => ({
  handleAIProviderRequest: vi.fn(async (input) => {
    if (!state.providerHandler) throw new Error('Unexpected source-fixture model handler')
    return state.providerHandler(input)
  }),
}))
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
const stamp = `member-${Date.now()}`
let db: typeof import('@tradinggoose/db').db
let adapter: Pick<
  Awaited<ReturnType<typeof betterAuth>['$context']>['adapter'],
  'create' | 'update' | 'updateMany' | 'delete'
>
let rollbackAdapterSubscription: (id: string, status: string) => Promise<unknown>
let contacts = 0
let benchmarkWork: Promise<void> | undefined
let benchmarkOutcome: 'not-started' | 'running' | 'fulfilled' | 'rejected' = 'not-started'
let fixtureNumber = 0
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value))
const tx = <T>(run: (bound: policy.FinancialTransaction) => Promise<T>) => db.transaction(run)
const ns = (id: string) => policy.financialNamespace({ type: 'organization', id })
const pair = (org: string, user: string) =>
  policy.readFinancialReceipt(db, ns(org), policy.memberRegistrationKey(user))
const ledger = async (org: string, user: string) =>
  (
    await db
      .select()
      .from(tables.organizationMemberBillingLedger)
      .where(
        and(
          eq(tables.organizationMemberBillingLedger.organizationId, org),
          eq(tables.organizationMemberBillingLedger.userId, user)
        )
      )
  )[0]
async function person(label: string, stripeCustomerId?: string, customUsageLimit = '100') {
  const id = `${stamp}-${label}-${randomUUID()}`
  const at = new Date()
  await db.insert(tables.user).values({
    id,
    name: 'Disposable registered member',
    email: `${id}@invalid.test`,
    emailVerified: true,
    stripeCustomerId,
    createdAt: at,
    updatedAt: at,
  })
  await db.insert(tables.userStats).values({
    id: `${id}-stats`,
    userId: id,
    grantedOnboardingAllowanceUsd: '0.3',
    customUsageLimit,
  })
  return id
}
async function pristineOrganizationFixture() {
  const owner = await person('owner')
  const tag = `${stamp}-${fixtureNumber++}`
  const created = await adapter.create<{ id: string }>({
    model: 'organization',
    data: { name: 'Disposable actual adapter root', slug: tag, createdAt: new Date() },
  })
  await adapter.create({
    model: 'member',
    data: { organizationId: created.id, userId: owner, role: 'owner', createdAt: new Date() },
  })
  return { id: created.id, owner, tag }
}
async function organizationFixture(seats = 3, usageScope: 'individual' | 'pooled' = 'individual') {
  const { id, owner, tag } = await pristineOrganizationFixture()
  const tier = `${tag}-tier`
  const sub = `${tag}-sub`
  const start = new Date('2026-01-01T00:00:00Z')
  const end = new Date('2026-02-01T00:00:00Z')
  await db.insert(tables.systemBillingTier).values({
    id: tier,
    displayName: 'Disposable member capacity',
    description: 'Actual protected member registration',
    status: 'active',
    ownerType: 'organization',
    usageScope,
    seatMode: 'fixed',
    seatCount: seats,
    includedUsageLimitUsd: '20',
  })
  await adapter.create({
    model: 'subscription',
    data: {
      plan: tier,
      referenceId: id,
      stripeCustomerId: `cus_${tag}`,
      stripeSubscriptionId: `sub_${tag}`,
      status: 'active',
      seats,
      periodStart: start,
      periodEnd: end,
    },
  })
  const workspaceId = `${tag}-workspace`
  await db.insert(tables.workspace).values({
    id: workspaceId,
    name: 'Disposable registered target',
    ownerId: owner,
    billingOwnerType: 'organization',
    billingOwnerOrganizationId: id,
    billingOwnerUserId: null,
  })
  return { id, owner, workspaceId, tag }
}
async function cost(
  f: { id: string; owner: string; workspaceId: string },
  userId = f.owner,
  amount = '0.3'
) {
  const key = randomUUID()
  const binding = await tx((bound) =>
    policy.createInvocation(bound, {
      actorUserId: userId,
      workspaceId: f.workspaceId,
      runId: key,
      operationKey: key,
      purpose: 'copilot',
      quotedHoldUsd: '0.1',
      schedulerReady: true,
    })
  )
  await tx((bound) => policy.admitModelStep(bound, binding, { stepNumber: 0, retryCount: 0 }, true))
  await tx((bound) =>
    policy.acceptModelStep(
      bound,
      binding,
      { stepNumber: 0, retryCount: 0 },
      { permittedProductUsd: amount, usage: { totalTokens: 7 } }
    )
  )
  expect(
    await tx((bound) => policy.verifyAcceptance(bound, binding, { stepNumber: 0, retryCount: 0 }))
  ).toMatchObject({ accepted: true, appliedUsd: amount })
  return binding
}
async function rollbackProbe(run: (bound: policy.FinancialTransaction) => Promise<void>) {
  await expect(
    db.transaction(async (bound) => {
      await run(bound)
      throw new Error('Intentional disposable corruption rollback')
    })
  ).rejects.toThrow('Intentional disposable corruption rollback')
}
async function waitForBlockedSession(blocker: number) {
  const deadline = performance.now() + 1000
  while (performance.now() < deadline) {
    const rows = await db.execute(sql`SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND usename = current_user
      AND pid <> pg_backend_pid() AND ${blocker} = ANY(pg_blocking_pids(pid))`)
    if (rows.length > 1) throw new Error('Disposable lock schedule has ambiguous waiters')
    const pid = rows[0]?.pid
    if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0) return pid
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Actual disposable PostgreSQL blocking order was not observed')
}

async function memberOwnedWorkspaceFixture() {
  const f = await organizationFixture()
  const workspaceOwnerId = await person('workspace-owner')
  await adapter.create({
    model: 'member',
    data: { organizationId: f.id, userId: workspaceOwnerId, role: 'member', createdAt: new Date() },
  })
  const workspaceId = `${f.tag}-personal-workspace`
  await db.insert(tables.workspace).values({
    id: workspaceId,
    name: 'Disposable reassignment target',
    ownerId: workspaceOwnerId,
    billingOwnerType: 'user',
    billingOwnerUserId: workspaceOwnerId,
    billingOwnerOrganizationId: null,
  })
  await db.insert(tables.permissions).values({
    id: randomUUID(),
    entityType: 'workspace',
    entityId: workspaceId,
    userId: f.owner,
    permissionType: 'admin',
  })
  state.session = { user: { id: f.owner, email: `${f.owner}@invalid.test` } }
  return { ...f, workspaceId, workspaceOwnerId }
}
async function invoiceFixture() {
  const f = await organizationFixture()
  const binding = await cost(f, f.owner, '20.1')
  const invocation = await policy.readFinancialReceipt(db, binding.namespace, binding.key)
  if (invocation?.recordType !== 'invocation' || !invocation.identity.period)
    throw new Error('Actual original invoice period required')
  const period = invocation.identity.period
  await tx((bound) =>
    policy.closeFinancialPeriod(bound, { type: 'organization', id: f.id }, period)
  )
  const intent = await tx((bound) =>
    policy.evaluateFinancialPeriod(bound, binding.namespace, policy.periodKey(period), 'final')
  )
  if (intent?.recordType !== 'invoice') throw new Error('Actual accepted overage invoice required')
  const candidates = await policy.listFinancialDispatch(db, Date.now())
  const matching = []
  for (const candidate of candidates.filter((row) => row.namespace === binding.namespace)) {
    const receipt = await policy.readFinancialReceipt(db, candidate.namespace, candidate.key)
    if (receipt?.recordType === 'invoice' && receipt.fingerprint === intent.fingerprint)
      matching.push(candidate)
  }
  if (matching.length !== 1) throw new Error('Exact original indexed invoice candidate required')
  return { ...f, binding, period, intent, candidate: matching[0] }
}
const invoiceRequest = (intent: policy.InvoiceReceipt, phase: string, now: number) => ({
  provider: 'stripe' as const,
  requestKey: `${intent.requestKey}:${phase}`,
  fingerprint: policy.financialFingerprint({ intent: intent.fingerprint, phase }),
  now,
})

suite('genuine member registration with disposable PostgreSQL', () => {
  beforeAll(async () => {
    ;({ db } = await import('@tradinggoose/db'))
    const [owned] = await db.execute(sql`SELECT current_database() AS database,
      shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()`)
    expect(owned).toMatchObject(originalState!)
    await policy.assertFinancialStorageReady(db)
    await db
      .insert(tables.systemSettings)
      .values({ id: 'global', billingEnabled: true })
      .onConflictDoUpdate({ target: tables.systemSettings.id, set: { billingEnabled: true } })
    await db.insert(tables.systemBillingSettings).values({ id: 'global' }).onConflictDoNothing()
    const { financialDrizzleAdapter } = await import('./financial-adapter')
    const client = new Stripe('sk_test_disposable_not_real', {
      maxNetworkRetries: 0,
      httpClient: Stripe.createFetchHttpClient(async () => {
        contacts++
        throw new Error('Unexpected real provider contact')
      }),
    })
    const auth = betterAuth({
      baseURL: 'http://127.0.0.1:55440',
      secret: 'disposable-auth-secret-only-32-characters',
      database: financialDrizzleAdapter,
      plugins: [
        organizationPlugin(),
        stripePlugin({
          stripeClient: client,
          stripeWebhookSecret: 'whsec_disposable',
          createCustomerOnSignUp: false,
          subscription: { enabled: true, plans: [] },
        }),
      ],
    })
    const context = await auth.$context
    adapter = context.adapter
    rollbackAdapterSubscription = (id, status) =>
      context.adapter.transaction(async (bound) => {
        await bound.update({
          model: 'subscription',
          where: [{ field: 'id', value: id }],
          update: { status },
        })
        throw new Error('Intentional disposable corruption rollback')
      })
  })
  afterAll(async () => {
    const failures: unknown[] = []
    try {
      if (benchmarkWork) {
        const [outcome] = await Promise.allSettled([benchmarkWork])
        if (outcome.status === 'rejected') failures.push(outcome.reason)
      }
      try {
        expect(benchmarkOutcome).not.toBe('running')
        expect(contacts).toBe(0)
        expect(fetch).not.toHaveBeenCalled()
      } catch (error) {
        failures.push(error)
      }
    } finally {
      const [close] = await Promise.allSettled([Promise.resolve().then(() => db.$client.end())])
      console.info(
        'R12_SQL_POOL_CLOSED ' +
          JSON.stringify({ closed: close.status === 'fulfilled', benchmarkOutcome })
      )
      if (close.status === 'rejected') failures.push(close.reason)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Disposable source fixture assertion or resource closure failed'
      )
  })
  afterEach(async () => {
    if (!db) return
    // Each fixture is below its real included allowance. Use the ordinary provider-free
    // evaluation path so global backpressure is not an accidental cross-test dependency.
    const { dispatchFinancialMarkers } = await import('./dispatcher')
    for (let tick = 0; tick < 3; tick++) await dispatchFinancialMarkers()
  })

  it('R12 synthetic million-settled indexed0/10/1000 hold benchmark measures CURRENT and FINAL admission without financial-conformance claims', () => {
    benchmarkOutcome = 'running'
    console.info('R12_BENCHMARK_STARTED ' + JSON.stringify({ started: true }))
    benchmarkWork = Promise.resolve()
      .then(async () => {
        const began = performance.now()
        const stage = (name: string, details: Record<string, unknown> = {}) =>
          console.info(
            'R12_BENCHMARK_STAGE ' +
              JSON.stringify({ stage: name, elapsedMs: performance.now() - began, ...details })
          )
        const beforeSeed = await policy.probeFinancialBackpressure(db)
        stage('scheduler-before-seed', beforeSeed)
        expect(beforeSeed.blocked).toBe(false)
        const f = await organizationFixture(3, 'individual')
        const held = await r12Binding(policy, f, '0.00000000000000001', 'embedding')
        await tx((bound) => policy.admitModelStep(bound, held, firstScopeOccurrence, true))
        const template = await policy.readFinancialReceipt(
          db,
          held.namespace,
          policy.occurrenceKey(held, firstScopeOccurrence)
        )
        if (template?.recordType !== 'operation')
          throw new Error('Actual public operation/template required for scale proof')
        await tx((bound) =>
          policy.releaseProvenUnused(bound, held, firstScopeOccurrence, {
            refusedBeforeDelegation: true,
          })
        )
        const prefix = 'r12-synthetic-closed-'
        stage('seed-start')
        await db.execute(sql`INSERT INTO idempotency_key(key, namespace, result)
      SELECT ${prefix} || lpad(n::text,7,'0'), ${held.namespace}, '{"recordType":"operation","holdState":"closed","financialClosureState":"closed","dispatchState":"complete"}'::json
      FROM generate_series(1,1000000) n`)
        stage('seed-complete')
        const counts = await db.execute(
          sql`SELECT count(*)::int AS n FROM idempotency_key WHERE namespace = ${held.namespace} AND key LIKE ${prefix + '%'}`
        )
        expect(counts[0].n).toBe(1000000)
        stage('settled-count-verified')
        await db.execute(sql`ANALYZE idempotency_key`)
        stage('index-statistics-request-complete')
        const afterSeed = await policy.probeFinancialBackpressure(db)
        stage('scheduler-after-seed', afterSeed)
        expect(afterSeed.blocked).toBe(false)
        const measured = await r12Binding(policy, f, '1', 'embedding')
        const measurements: Array<Record<string, unknown>> = []
        let added = 0
        let stepNumber = 0
        for (const active of [0, 10, 1000]) {
          stage('active-scale-start', { active })
          const rows: Array<typeof tables.idempotencyKey.$inferInsert> = []
          for (; added < active; added++) {
            const key = policy.occurrenceKey(held, { stepNumber: added + 10000, retryCount: 0 })
            rows.push({
              namespace: held.namespace,
              key,
              result: {
                ...template,
                fingerprint: policy.financialFingerprint([held.fingerprint, key]),
              },
            })
          }
          if (rows.length) await db.insert(tables.idempotencyKey).values(rows)
          const sum = await db.execute(
            sql`SELECT COALESCE(SUM((result->'identity'->'quote'->>'holdUsd')::numeric),0) AS exact FROM idempotency_key WHERE namespace = ${held.namespace} AND ${policy.outstandingPredicate}`
          )
          expect(policy.monetary(sum[0].exact)).toBe(
            policy.multiplyMoney('0.00000000000000001', policy.decimalFromSafeInteger(active))
          )
          const plan = await db.execute(
            sql`EXPLAIN (FORMAT JSON) SELECT key,result FROM idempotency_key WHERE namespace = ${held.namespace} AND ${policy.outstandingPredicate}`
          )
          expect(JSON.stringify(plan)).toContain('idempotency_billing_outstanding_idx')
          stage('index-verified', { active })
          for (const [label, api] of [
            ['CURRENT', currentBuiltPolicy],
            ['FINAL', policy],
          ] as const) {
            const times: number[] = []
            for (let sample = 0; sample < 45; sample++) {
              const occurrence = { stepNumber: stepNumber++, retryCount: 0 }
              const start = performance.now()
              await tx((bound) => api.admitModelStep(bound, measured, occurrence, true))
              if (sample >= 5) times.push(performance.now() - start)
              await tx((bound) =>
                api.releaseProvenUnused(bound, measured, occurrence, {
                  refusedBeforeDelegation: true,
                })
              )
            }
            times.sort((a, b) => a - b)
            const p95 = times[Math.ceil(times.length * 0.95) - 1]
            stage('measurement', { api: label, active, p95Ms: p95, samples: 40, warmup: 5 })
            expect(p95).toBeLessThanOrEqual(250)
            measurements.push({
              label,
              syntheticActiveHolds: active,
              sameOwnerSyntheticSettled: 1000000,
              warmup: 5,
              samples: 40,
              admissionP95Ms: p95,
              originalInvocationAnchors: active ? 1 : 0,
            })
          }
        }
        console.info('R12_SYNTHETIC_PERFORMANCE ' + JSON.stringify(measurements))
      })
      .then(
        () => {
          benchmarkOutcome = 'fulfilled'
          console.info('R12_BENCHMARK_SETTLED ' + JSON.stringify({ outcome: benchmarkOutcome }))
        },
        (error: unknown) => {
          benchmarkOutcome = 'rejected'
          console.info('R12_BENCHMARK_SETTLED ' + JSON.stringify({ outcome: benchmarkOutcome }))
          throw error
        }
      )
    return benchmarkWork
  }, 45000)

  it.each(['no-response', 'partial-error', 'finish-error'] as const)(
    'R9 current processors preserve real uncertain original holds after %s without acceptance',
    async (mode) => {
      const f = await organizationFixture()
      const before = asJson(await ledger(f.id, f.owner))
      const { financialProcessors } = await import('@/lib/mastra/financial-processors')
      const runId = randomUUID()
      let contacts = 0
      let captured = ''
      const finance = await financialProcessors(
        { actorUserId: f.owner, workspaceId: f.workspaceId, runId, purpose: 'workflow-provider' },
        ({ readResponse }) => {
          captured = JSON.stringify(readResponse())
        }
      )
      const model = new MastraLanguageModelV2Mock({
        doGenerate: async () => {
          contacts++
          throw new Error('R9 synthetic no-response contact')
        },
        doStream: async () => {
          contacts++
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'text-start', id: 'partial' })
                controller.enqueue({
                  type: 'text-delta',
                  id: 'partial',
                  delta: 'genuine original partial',
                })
                controller.enqueue({ type: 'text-end', id: 'partial' })
                if (mode === 'finish-error')
                  controller.enqueue({
                    type: 'finish',
                    finishReason: 'stop',
                    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
                  })
                controller.enqueue({
                  type: 'error',
                  error: new Error('R9 synthetic failed response'),
                })
                controller.close()
              },
            }),
          }
        },
      })
      const agent = new Agent({
        id: `r9-${runId}`,
        name: 'Disposable financial response',
        instructions: 'test',
        model,
        inputProcessors: finance.inputProcessors,
        outputProcessors: finance.outputProcessors,
      })
      try {
        if (mode === 'no-response')
          await agent.generate('test', { runId, modelSettings: { maxRetries: 0 } })
        else {
          const output = await agent.stream('test', { runId, modelSettings: { maxRetries: 0 } })
          for await (const _part of output.fullStream) {
            /* genuine installed core */
          }
        }
      } catch {
        /* the original failure is retained by the processor latch */
      }
      expect(contacts).toBe(1)
      const occurrence = { stepNumber: 0, retryCount: 0, runId }
      const receipt = await policy.readFinancialReceipt(
        db,
        finance.binding.namespace,
        policy.occurrenceKey(finance.binding, occurrence)
      )
      expect(receipt).toMatchObject({
        recordType: 'operation',
        contactState: 'uncertain',
        holdState: 'outstanding',
        binding: finance.binding,
        identity: { root: { type: 'organization', id: f.id }, memberUserId: f.owner },
      })
      expect(receipt && Object.hasOwn(receipt, 'appliedUsd')).toBe(false)
      expect(asJson(await ledger(f.id, f.owner))).toEqual(before)
      await expect(
        tx((bound) => policy.verifyAcceptance(bound, finance.binding, occurrence))
      ).rejects.toThrow()
      await expect(finance.verifyComplete()).rejects.toThrow()
      await expect(
        finance.inputProcessors[0]!.processInputStep!({
          runId,
          stepNumber: 1,
          retryCount: 0,
        } as any)
      ).rejects.toThrow()
      expect(contacts).toBe(1)
      if (mode !== 'no-response') expect(captured).toContain('genuine original partial')
      if (mode === 'finish-error')
        expect(finance.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
      else expect(finance.getUsage()).toEqual({})
    }
  )

  it.each(['generate', 'stream'] as const)(
    'R9 current processors accept genuine empty %s success through selected FINAL policy',
    async (method) => {
      const f = await organizationFixture()
      const { financialProcessors } = await import('@/lib/mastra/financial-processors')
      const runId = randomUUID()
      const finance = await financialProcessors({
        actorUserId: f.owner,
        workspaceId: f.workspaceId,
        runId,
        purpose: 'workflow-provider',
      })
      const usage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }
      const model = new MastraLanguageModelV2Mock({
        doGenerate: async () => ({ content: [], finishReason: 'stop', usage, warnings: [] }),
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'finish', finishReason: 'stop', usage })
              controller.close()
            },
          }),
        }),
      })
      const agent = new Agent({
        id: `r9-empty-${runId}`,
        name: 'Disposable empty response',
        instructions: 'test',
        model,
        inputProcessors: finance.inputProcessors,
        outputProcessors: finance.outputProcessors,
      })
      if (method === 'generate')
        await agent.generate('test', { runId, modelSettings: { maxRetries: 0 } })
      else {
        const output = await agent.stream('test', { runId, modelSettings: { maxRetries: 0 } })
        for await (const _part of output.fullStream) {
          /* complete */
        }
      }
      await expect(finance.verifyComplete()).resolves.toBeUndefined()
      const receipt = await policy.readFinancialReceipt(
        db,
        finance.binding.namespace,
        policy.occurrenceKey(finance.binding, { stepNumber: 0, retryCount: 0, runId })
      )
      expect(receipt).toMatchObject({
        recordType: 'operation',
        contactState: 'accepted',
        holdState: 'closed',
        modelUsd: 'unavailable',
      })
      expect(typeof (receipt?.recordType === 'operation' && receipt.appliedUsd)).toBe('string')
      expect(finance.getUsage()).toEqual({})
    }
  )

  it('R9 actual tool-only first response stays accepted while a later failed contact keeps its distinct hold', async () => {
    const f = await organizationFixture()
    const { financialProcessors } = await import('@/lib/mastra/financial-processors')
    const runId = randomUUID()
    const finance = await financialProcessors({
      actorUserId: f.owner,
      workspaceId: f.workspaceId,
      runId,
      purpose: 'workflow-provider',
    })
    let contacts = 0
    let effects = 0
    const model = new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        if (contacts++ > 0) throw new Error('R9 failed second contact')
        return {
          content: [{ type: 'tool-call', toolCallId: 'r9-local', toolName: 'local', input: '{}' }],
          finishReason: 'tool-calls',
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          warnings: [],
        }
      },
    })
    const agent = new Agent({
      id: `r9-steps-${runId}`,
      name: 'Disposable steps',
      instructions: 'test',
      model,
      tools: {
        local: createTool({
          id: 'local',
          description: 'Synthetic local effect',
          inputSchema: z.object({}),
          execute: async () => {
            effects++
            return { ok: true }
          },
        }),
      },
      inputProcessors: finance.inputProcessors,
      outputProcessors: finance.outputProcessors,
    })
    try {
      await agent.generate('test', { runId, maxSteps: 2, modelSettings: { maxRetries: 0 } })
    } catch {
      /* preserved failed later contact */
    }
    expect(contacts).toBe(2)
    expect(effects).toBe(1)
    const first = { stepNumber: 0, retryCount: 0, runId }
    const second = { stepNumber: 1, retryCount: 0, runId }
    expect(
      await tx((bound) => policy.verifyAcceptance(bound, finance.binding, first))
    ).toMatchObject({ accepted: true })
    expect(
      await policy.readFinancialReceipt(
        db,
        finance.binding.namespace,
        policy.occurrenceKey(finance.binding, second)
      )
    ).toMatchObject({
      recordType: 'operation',
      contactState: 'uncertain',
      holdState: 'outstanding',
    })
    await expect(
      tx((bound) => policy.verifyAcceptance(bound, finance.binding, second))
    ).rejects.toThrow()
    await expect(finance.verifyComplete()).rejects.toThrow('R9 failed second contact')
    expect(finance.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
  })

  it('R9 actual selected policy freezes original customer fallback and clears only completed phase envelopes', async () => {
    const f = await invoiceFixture()
    const execute = await r8DefaultExecute()
    const stripeRuntime = await import('@/lib/system-services/stripe-runtime')
    const config = vi
      .spyOn(stripeRuntime, 'getStripeServiceConfig')
      .mockReturnValue({ secretKey: 'sk_test_disposable_only', webhookSecret: null })
    const originalFetch = globalThis.fetch
    const method = 'pm_original_customer_setting'
    let remote: Record<string, any> | undefined
    let subscriptionReads = 0
    const posts: string[] = []
    const before = asJson(await ledger(f.id, f.owner))
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      expect(url.origin).toBe('https://api.stripe.com')
      const verb = init?.method ?? 'GET'
      const body = new URLSearchParams(String(init?.body ?? ''))
      const reply = (value: unknown) => Response.json(value)
      if (verb === 'GET' && url.pathname === `/v1/subscriptions/${f.period.stripeSubscriptionId}`) {
        subscriptionReads++
        return reply({
          id: f.period.stripeSubscriptionId,
          customer: f.period.customerId,
          default_payment_method: null,
        })
      }
      if (verb === 'GET' && url.pathname === `/v1/customers/${f.period.customerId}`)
        return reply({
          id: f.period.customerId,
          object: 'customer',
          invoice_settings: { default_payment_method: { id: method } },
        })
      if (
        verb === 'GET' &&
        url.pathname === `/v1/customers/${f.period.customerId}/payment_methods/${method}`
      )
        return reply({
          id: method,
          object: 'payment_method',
          customer: { id: f.period.customerId },
        })
      if (verb === 'GET' && url.pathname === '/v1/invoices/in_r9_customer') return reply(remote)
      if (verb === 'POST') {
        const receipt = await policy.readFinancialReceipt(
          db,
          f.candidate.namespace,
          f.candidate.key
        )
        if (receipt?.recordType !== 'invoice')
          throw new Error('Original receipt required before synthetic POST')
        const marker = receipt.markers.find((value) => value.state === 'claimed')!
        expect(marker.payload).toMatchObject({
          version: 1,
          stage: 'request',
          paymentMethod: { id: method, source: 'customer' },
          original: { period: f.period, amountCents: '10' },
        })
        expect(marker.payload?.requestFingerprint).toBe(
          policy.financialFingerprint(marker.payload?.request)
        )
        posts.push(url.pathname)
      }
      if (verb === 'POST' && url.pathname === '/v1/invoices') {
        expect(body.get('default_payment_method')).toBe(method)
        remote = {
          id: 'in_r9_customer',
          object: 'invoice',
          customer: f.period.customerId,
          currency: 'usd',
          status: 'draft',
          total: 0,
          amount_paid: 0,
          default_payment_method: method,
          metadata: Object.fromEntries(
            [...body]
              .filter(([key]) => key.startsWith('metadata['))
              .map(([key, value]) => [key.slice(9, -1), value])
          ),
        }
        return reply(remote)
      }
      if (verb === 'POST' && url.pathname === '/v1/invoiceitems')
        return reply({
          id: 'ii_r9_customer',
          object: 'invoiceitem',
          customer: f.period.customerId,
          invoice: remote!.id,
          amount: 10,
          currency: 'usd',
          metadata: remote!.metadata,
        })
      if (verb === 'POST' && url.pathname === '/v1/invoices/in_r9_customer/finalize') {
        remote = { ...remote, status: 'open', total: 10 }
        return reply(remote)
      }
      if (verb === 'POST' && url.pathname === '/v1/invoices/in_r9_customer/pay') {
        expect(body.get('payment_method')).toBe(method)
        remote = { ...remote, status: 'paid', amount_paid: 10 }
        return reply(remote)
      }
      throw new Error('Unexpected R9 synthetic Stripe request')
    })
    try {
      for (const phase of ['create', 'item', 'finalize', 'pay']) {
        const receipt = await policy.readFinancialReceipt(
          db,
          f.candidate.namespace,
          f.candidate.key
        )
        if (receipt?.recordType !== 'invoice') throw new Error('Actual original invoice required')
        const claim = await tx((bound) =>
          policy.claimFinancialDispatch(
            bound,
            { ...f.candidate, due: receipt.dispatchAtMs },
            Date.now()
          )
        )
        expect(claim?.marker.phase).toBe(phase)
        if (!claim) throw new Error('Actual claim required')
        await execute(claim, Date.now() + 20_000)
        const current = await policy.readFinancialReceipt(
          db,
          f.candidate.namespace,
          f.candidate.key
        )
        if (current?.recordType !== 'invoice') throw new Error('Actual original readback required')
        if (phase !== 'pay') {
          for (const field of [
            'payload',
            'provider',
            'requestKey',
            'requestFingerprint',
            'firstContactAtMs',
          ])
            expect(Object.hasOwn(current.markers[0], field)).toBe(false)
          expect(current.markers[0].state).toBe('pending')
        } else expect(current.invoiceObligationState).toBe('closed')
      }
      expect(subscriptionReads).toBe(1)
      expect(posts).toEqual([
        '/v1/invoices',
        '/v1/invoiceitems',
        '/v1/invoices/in_r9_customer/finalize',
        '/v1/invoices/in_r9_customer/pay',
      ])
      const after = await ledger(f.id, f.owner)
      expect(after.totalCost).toBe(before.totalCost)
      expect(after.totalTokensUsed).toBe(before.totalTokensUsed)
    } finally {
      globalThis.fetch = originalFetch
      config.mockRestore()
    }
  })

  it.each(['subscription-customer', 'method-owner'] as const)(
    'R9 actual original %s mismatch cannot prepare an economic request or POST',
    async (mismatch) => {
      const f = await invoiceFixture()
      const execute = await r8DefaultExecute()
      const stripeRuntime = await import('@/lib/system-services/stripe-runtime')
      const config = vi
        .spyOn(stripeRuntime, 'getStripeServiceConfig')
        .mockReturnValue({ secretKey: 'sk_test_disposable_only', webhookSecret: null })
      const originalFetch = globalThis.fetch
      let posts = 0
      globalThis.fetch = vi.fn(async (input, init) => {
        if (init?.method === 'POST') {
          posts++
          throw new Error('No economic contact authorized')
        }
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
        if (url.pathname === `/v1/subscriptions/${f.period.stripeSubscriptionId}`)
          return Response.json({
            id: f.period.stripeSubscriptionId,
            customer: mismatch === 'subscription-customer' ? 'cus_foreign' : f.period.customerId,
            default_payment_method: 'pm_r9_original',
          })
        if (url.pathname === `/v1/customers/${f.period.customerId}`)
          return Response.json({
            id: f.period.customerId,
            object: 'customer',
            invoice_settings: { default_payment_method: 'pm_other_default' },
          })
        return Response.json({
          id: 'pm_r9_original',
          object: 'payment_method',
          customer: 'cus_foreign',
        })
      })
      try {
        const before = asJson(await ledger(f.id, f.owner))
        const claim = await tx((bound) =>
          policy.claimFinancialDispatch(bound, f.candidate, Date.now())
        )
        if (!claim) throw new Error('Original claim required')
        await expect(execute(claim, Date.now() + 20_000)).rejects.toThrow('does not match')
        const receipt = await policy.readFinancialReceipt(
          db,
          f.candidate.namespace,
          f.candidate.key
        )
        expect(receipt).toMatchObject({
          recordType: 'invoice',
          invoiceObligationState: 'open',
          issuance: 'pending',
          period: f.period,
          amountCents: '10',
        })
        if (receipt?.recordType !== 'invoice') throw new Error('Original invoice required')
        expect(receipt.invoiceId).toBeUndefined()
        expect(Object.hasOwn(receipt.markers[0], 'payload')).toBe(false)
        expect(posts).toBe(0)
        expect(asJson(await ledger(f.id, f.owner))).toEqual(before)
      } finally {
        globalThis.fetch = originalFetch
        config.mockRestore()
      }
    }
  )

  it('R9 real prepared lookup-only create remains refused on recovery instead of inferring that an economic POST never happened', async () => {
    const f = await invoiceFixture()
    const execute = await r8DefaultExecute()
    const stripeRuntime = await import('@/lib/system-services/stripe-runtime')
    const config = vi
      .spyOn(stripeRuntime, 'getStripeServiceConfig')
      .mockReturnValue({ secretKey: 'sk_test_disposable_only', webhookSecret: null })
    try {
      const claim = await tx((bound) =>
        policy.claimFinancialDispatch(bound, f.candidate, Date.now())
      )
      if (!claim) throw new Error('Original claim required')
      await tx((bound) =>
        policy.prepareFinancialContact(bound, claim, invoiceRequest(f.intent, 'create', Date.now()))
      )
      const recovered = await tx((bound) =>
        policy.claimFinancialDispatch(bound, f.candidate, claim.marker.claimExpiresAtMs! + 1)
      )
      if (!recovered) throw new Error('Actual uncertain recovery claim required')
      expect(recovered.reconcile).toBe(true)
      await expect(execute(recovered, Date.now() + 20_000)).rejects.toThrow(
        'request envelope is missing'
      )
      expect(fetch).not.toHaveBeenCalled()
      const current = await policy.readFinancialReceipt(db, f.candidate.namespace, f.candidate.key)
      expect(current).toMatchObject({
        recordType: 'invoice',
        invoiceObligationState: 'open',
        period: f.period,
        amountCents: '10',
      })
      if (current?.recordType !== 'invoice') throw new Error('Original invoice required')
      expect(current.markers[0].firstContactAtMs).toBe(claim.marker.firstContactAtMs)
      expect(current.markers[0].requestFingerprint).toBe(claim.marker.requestFingerprint)
      expect(current.invoiceId).toBeUndefined()
    } finally {
      config.mockRestore()
    }
  })

  // R12 raw CURRENT and physically installed FINAL admission share no APP preguard.
  async function r12Binding(
    api: typeof policy,
    f: { workspaceId: string; owner: string },
    amount = '1',
    purpose = 'copilot'
  ) {
    return tx((bound) =>
      api.createInvocation(bound, {
        actorUserId: f.owner,
        workspaceId: f.workspaceId,
        runId: randomUUID(),
        operationKey: randomUUID(),
        purpose,
        quotedHoldUsd: amount,
        schedulerReady: true,
      })
    )
  }
  async function r12Allowance(api: typeof policy, id: string, tier: string, allowance: string) {
    await tx(async (bound) => {
      await bound.execute(sql`SELECT pg_advisory_xact_lock(${api.CATALOG_LOCK}::bigint)`)
      await api.lockFinancialRoots(bound, [{ type: 'organization', id }])
      await bound
        .update(tables.systemBillingTier)
        .set({ includedUsageLimitUsd: allowance })
        .where(eq(tables.systemBillingTier.id, tier))
    })
  }
  async function r12Fixture(
    api: typeof policy,
    scope: 'pooled' | 'individual',
    writer: 'adapter' | 'direct' = 'direct',
    otherActor = false,
    amount = '20'
  ) {
    const f = await organizationFixture(3, scope)
    const [originalTier] = await db
      .select()
      .from(tables.systemBillingTier)
      .where(eq(tables.systemBillingTier.id, `${f.tag}-tier`))
    const [sub] = await db
      .select()
      .from(tables.subscription)
      .where(
        and(
          eq(tables.subscription.referenceType, 'organization'),
          eq(tables.subscription.referenceId, f.id)
        )
      )
    if (!originalTier || !sub) throw new Error('Actual original tier/subscription required')
    const requestedTierId = `${f.tag}-r12-next`
    await db.insert(tables.systemBillingTier).values({
      ...originalTier,
      id: requestedTierId,
      usageScope: 'individual',
      includedUsageLimitUsd: '21',
    })
    let oldActor = f.owner
    if (otherActor) {
      oldActor = await person('r12-old-actor')
      await adapter.create({
        model: 'member',
        data: { organizationId: f.id, userId: oldActor, role: 'member', createdAt: new Date() },
      })
      await db.insert(tables.permissions).values({
        id: randomUUID(),
        entityType: 'workspace',
        entityId: f.workspaceId,
        userId: oldActor,
        permissionType: 'write',
      })
    }
    const old = await r12Binding(api, { ...f, owner: oldActor }, amount)
    await tx((bound) => api.admitModelStep(bound, old, firstScopeOccurrence, true))
    const original = await api.readFinancialReceipt(
      db,
      old.namespace,
      api.occurrenceKey(old, firstScopeOccurrence)
    )
    const full = { ...f, originalTier, requestedTierId, subId: sub.id }
    await mutateScopeSubscription(writer, full, {
      plan: requestedTierId,
      periodStart: new Date('2026-02-01T00:00:00Z'),
      periodEnd: new Date('2026-03-01T00:00:00Z'),
    })
    const current = await r12Binding(api, f)
    await tx((bound) => api.admitModelStep(bound, current, firstScopeOccurrence, true))
    await tx((bound) =>
      api.acceptModelStep(bound, current, firstScopeOccurrence, {
        permittedProductUsd: '1',
        usage: { totalTokens: 3 },
      })
    )
    await r12Allowance(api, f.id, requestedTierId, '20')
    return { ...full, old, oldActor, current, original }
  }
  async function r12Originals(f: Awaited<ReturnType<typeof r12Fixture>>) {
    const invocation = await policy.readFinancialReceipt(db, f.old.namespace, f.old.key)
    const operation = await policy.readFinancialReceipt(
      db,
      f.old.namespace,
      policy.occurrenceKey(f.old, firstScopeOccurrence)
    )
    const period = await scopePeriod(f.old)
    return asJson({
      invocation,
      operation,
      basis: await policy.readFinancialReceipt(db, f.old.namespace, policy.periodKey(period)),
      root: (await scopeSnapshot(f)).organizationLedger,
      member: await ledger(f.id, f.owner),
    })
  }
  for (const [label, api] of [
    ['CURRENT', currentBuiltPolicy],
    ['FINAL', policy],
  ] as const) {
    for (const writer of ['adapter', 'direct'] as const) {
      for (const scope of ['pooled', 'individual'] as const) {
        it(`R12 ${label} ${writer} ${scope} surviving same-actor hold20 reserves individual1+20+1 and settles original liability once`, async () => {
          const f = await r12Fixture(api, scope, writer)
          const before = await r12Originals(f)
          const key = api.occurrenceKey(f.current, lateScopeOccurrence)
          await expect(
            tx((bound) => api.admitModelStep(bound, f.current, lateScopeOccurrence, true))
          ).rejects.toMatchObject({ status: 402 })
          expect(await api.readFinancialReceipt(db, f.current.namespace, key)).toBeNull()
          expect(await r12Originals(f)).toEqual(before)
          expect(f.original).toMatchObject({
            identity: {
              actorUserId: f.owner,
              memberUserId: scope === 'pooled' ? null : f.owner,
              quote: { holdUsd: '20' },
            },
            holdState: 'outstanding',
            contactState: 'uncertain',
          })
          await expect(
            tx((bound) => api.admitModelStep(bound, f.old, lateScopeOccurrence, true))
          ).rejects.toThrow('exact original open financial period')
          let oppositeTier = f.originalTier.id
          if (scope === 'individual') {
            oppositeTier = `${f.tag}-r12-forbidden-pooled`
            await db
              .insert(tables.systemBillingTier)
              .values({ ...f.originalTier, id: oppositeTier, usageScope: 'pooled' })
          }
          await expect(mutateScopeSubscription(writer, f, { plan: oppositeTier })).rejects.toThrow(
            'scope'
          )
          await tx((bound) =>
            api.acceptModelStep(bound, f.old, firstScopeOccurrence, {
              permittedProductUsd: '20',
              usage: { totalTokens: 7 },
            })
          )
          const settled = await r12Originals(f)
          expect(settled.root).toMatchObject({
            currentPeriodCost: '1',
            lastPeriodCost: '20',
            totalCost: '21',
          })
          expect(settled.member).toMatchObject({
            currentPeriodCost: '1',
            lastPeriodCost: scope === 'individual' ? '20' : '0',
            totalCost: scope === 'individual' ? '21' : '1',
          })
          expect(settled.operation).toMatchObject({
            identity: before.operation.identity,
            holdState: 'closed',
            contactState: 'accepted',
            appliedUsd: '20',
          })
          await tx((bound) =>
            api.acceptModelStep(bound, f.old, firstScopeOccurrence, {
              permittedProductUsd: '20',
              usage: { totalTokens: 7 },
            })
          )
          expect(await r12Originals(f)).toEqual(settled)
          await tx((bound) => api.admitModelStep(bound, f.current, lateScopeOccurrence, true))
          await tx((bound) =>
            api.releaseProvenUnused(bound, f.current, lateScopeOccurrence, {
              refusedBeforeDelegation: true,
            })
          )
        })
      }
    }
    for (const scope of ['pooled', 'individual'] as const) {
      it(`R12 ${label} excludes proved departed ${scope} actor but refuses missing original retained target`, async () => {
        const f = await r12Fixture(api, scope, 'direct', true)
        await db
          .delete(tables.member)
          .where(and(eq(tables.member.organizationId, f.id), eq(tables.member.userId, f.oldActor)))
        const before = await r12Originals(f)
        for (const target of ['pair', 'ledger'] as const)
          await rollbackProbe(async (bound) => {
            if (target === 'pair')
              await bound
                .delete(tables.idempotencyKey)
                .where(
                  and(
                    eq(tables.idempotencyKey.namespace, f.old.namespace),
                    eq(tables.idempotencyKey.key, api.memberRegistrationKey(f.oldActor))
                  )
                )
            else
              await bound
                .delete(tables.organizationMemberBillingLedger)
                .where(
                  and(
                    eq(tables.organizationMemberBillingLedger.organizationId, f.id),
                    eq(tables.organizationMemberBillingLedger.userId, f.oldActor)
                  )
                )
            await expect(
              api.admitModelStep(bound, f.current, lateScopeOccurrence, true)
            ).rejects.toMatchObject({ status: 409 })
            expect(
              await api.readFinancialReceipt(
                bound,
                f.current.namespace,
                api.occurrenceKey(f.current, lateScopeOccurrence)
              )
            ).toBeNull()
          })
        await tx((bound) => api.admitModelStep(bound, f.current, lateScopeOccurrence, true))
        expect(await r12Originals(f)).toEqual(before)
        await tx((bound) =>
          api.releaseProvenUnused(bound, f.current, lateScopeOccurrence, {
            refusedBeforeDelegation: true,
          })
        )
      })
    }
    it(`R12 ${label} refuses missing and conflicting original actor, member, invocation and fingerprint without repairing history`, async () => {
      const f = await r12Fixture(api, 'pooled')
      const oldKey = api.occurrenceKey(f.old, firstScopeOccurrence)
      const before = await r12Originals(f)
      for (const fault of [
        'missing-actor',
        'blank-actor',
        'binding-actor',
        'member-conflict',
        'foreign-root',
        'operation-fingerprint',
        'missing-invocation',
        'changed-invocation',
        'missing-invocation-binding',
        'missing-invocation-identity',
        'self-consistent-actor',
        'accepted-outstanding',
      ] as const) {
        await rollbackProbe(async (bound) => {
          const raw = structuredClone(before.operation)
          let key = oldKey
          if (fault === 'missing-actor') Reflect.deleteProperty(raw.identity, 'actorUserId')
          if (fault === 'blank-actor') raw.identity.actorUserId = ' '
          if (fault === 'binding-actor') raw.binding.actorUserId = 'unproved-original-actor'
          if (fault === 'member-conflict') raw.identity.memberUserId = f.owner
          if (fault === 'foreign-root') raw.identity.root.id = 'unproved-other-root'
          if (fault === 'operation-fingerprint') raw.fingerprint = 'unproved-operation'
          if (fault === 'accepted-outstanding') raw.contactState = 'accepted'
          if (fault === 'self-consistent-actor') {
            raw.identity.actorUserId = f.oldActor + '-changed'
            raw.binding.actorUserId = raw.identity.actorUserId
            raw.binding.fingerprint = api.financialFingerprint({
              identity: raw.identity,
              runId: raw.binding.runId,
            })
            raw.fingerprint = api.financialFingerprint([raw.binding.fingerprint, oldKey])
          }
          if (fault === 'missing-invocation')
            await bound
              .delete(tables.idempotencyKey)
              .where(
                and(
                  eq(tables.idempotencyKey.namespace, f.old.namespace),
                  eq(tables.idempotencyKey.key, f.old.key)
                )
              )
          else {
            if (
              [
                'changed-invocation',
                'missing-invocation-binding',
                'missing-invocation-identity',
              ].includes(fault)
            ) {
              key = f.old.key
              Object.assign(raw, structuredClone(before.invocation))
              if (fault === 'changed-invocation') raw.identity.actorUserId = f.owner + '-changed'
              if (fault === 'missing-invocation-binding') Reflect.deleteProperty(raw, 'binding')
              if (fault === 'missing-invocation-identity') Reflect.deleteProperty(raw, 'identity')
            }
            await bound
              .update(tables.idempotencyKey)
              .set({ result: raw })
              .where(
                and(
                  eq(tables.idempotencyKey.namespace, f.old.namespace),
                  eq(tables.idempotencyKey.key, key)
                )
              )
          }
          await expect(
            api.admitModelStep(bound, f.current, lateScopeOccurrence, true)
          ).rejects.toThrow('unprovable original financial-record evidence')
          expect(
            await api.readFinancialReceipt(
              bound,
              f.current.namespace,
              api.occurrenceKey(f.current, lateScopeOccurrence)
            )
          ).toBeNull()
        })
        expect(await r12Originals(f)).toEqual(before)
      }
    })
    it(`R12 ${label} exact equality and original proven-unused closure do not double reserve`, async () => {
      const f = await r12Fixture(api, 'pooled', 'direct', false, '18')
      await tx((bound) => api.admitModelStep(bound, f.current, lateScopeOccurrence, true))
      await tx((bound) =>
        api.releaseProvenUnused(bound, f.current, lateScopeOccurrence, {
          refusedBeforeDelegation: true,
        })
      )
      await tx((bound) =>
        api.releaseProvenUnused(bound, f.old, firstScopeOccurrence, {
          refusedBeforeDelegation: true,
        })
      )
      const before = await r12Originals(f)
      expect(before.operation).toMatchObject({
        identity: f.original?.recordType === 'operation' ? f.original.identity : undefined,
        contactState: 'unused',
        holdState: 'closed',
      })
      expect(before.root).toMatchObject({
        currentPeriodCost: '1',
        lastPeriodCost: '0',
        totalCost: '1',
      })
      await tx((bound) =>
        api.admitModelStep(bound, f.current, { stepNumber: 2, retryCount: 0 }, true)
      )
      expect((await r12Originals(f)).root).toEqual(before.root)
      await tx((bound) =>
        api.releaseProvenUnused(
          bound,
          f.current,
          { stepNumber: 2, retryCount: 0 },
          { refusedBeforeDelegation: true }
        )
      )
    })
    it(`R12 ${label} retains older-than-previous mixed-purpose holds and excludes another root`, async () => {
      const f = await r12Fixture(api, 'pooled')
      await r12Allowance(api, f.id, f.requestedTierId, '22')
      const embedding = await r12Binding(api, f, '0.1', 'embedding')
      await tx((bound) => api.admitModelStep(bound, embedding, firstScopeOccurrence, true))
      await mutateScopeSubscription('direct', f, {
        periodStart: new Date('2026-03-01T00:00:00Z'),
        periodEnd: new Date('2026-04-01T00:00:00Z'),
      })
      await r12Allowance(api, f.id, f.requestedTierId, '20')
      const current = await r12Binding(api, f)
      await expect(
        tx((bound) => api.admitModelStep(bound, current, firstScopeOccurrence, true))
      ).rejects.toMatchObject({ status: 402 })
      expect(
        await api.readFinancialReceipt(
          db,
          embedding.namespace,
          api.occurrenceKey(embedding, firstScopeOccurrence)
        )
      ).toMatchObject({
        holdState: 'outstanding',
        identity: { purpose: 'embedding', quote: { holdUsd: '0.1' } },
      })
      const isolated = await organizationFixture(3, 'individual')
      await adapter.create({
        model: 'member',
        data: {
          organizationId: isolated.id,
          userId: f.owner,
          role: 'member',
          createdAt: new Date(),
        },
      })
      await db.insert(tables.permissions).values({
        id: randomUUID(),
        entityType: 'workspace',
        entityId: isolated.workspaceId,
        userId: f.owner,
        permissionType: 'write',
      })
      await cost(isolated, f.owner, '1')
      const isolatedBinding = await r12Binding(api, { ...isolated, owner: f.owner })
      await tx((bound) => api.admitModelStep(bound, isolatedBinding, firstScopeOccurrence, true))
      await tx((bound) =>
        api.releaseProvenUnused(bound, isolatedBinding, firstScopeOccurrence, {
          refusedBeforeDelegation: true,
        })
      )
      expect((await r12Originals(f)).operation).toMatchObject({
        identity: { memberUserId: null },
        holdState: 'outstanding',
      })
    })
    for (const order of ['accept-first', 'admit-first'] as const) {
      it(`R12 ${label} actual root serialization ${order} preserves the old obligation and fresh refusal boundary`, async () => {
        const f = await r12Fixture(api, 'pooled')
        let entered!: (pid: number) => void
        let release!: () => void
        const locked = new Promise<number>((resolve) => {
          entered = resolve
        })
        const continueHolder = new Promise<void>((resolve) => {
          release = resolve
        })
        const holder = db.transaction(async (bound) => {
          await api.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
          const rows = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
          if (order === 'accept-first')
            await api.acceptModelStep(bound, f.old, firstScopeOccurrence, {
              permittedProductUsd: '20',
            })
          else
            await expect(
              api.admitModelStep(bound, f.current, lateScopeOccurrence, true)
            ).rejects.toMatchObject({ status: 402 })
          entered(Number(rows[0].pid))
          await continueHolder
        })
        const pid = await locked
        const waiter =
          order === 'accept-first'
            ? tx((bound) => api.admitModelStep(bound, f.current, lateScopeOccurrence, true))
            : tx((bound) =>
                api.acceptModelStep(bound, f.old, firstScopeOccurrence, {
                  permittedProductUsd: '20',
                })
              )
        try {
          expect(await waitForBlockedSession(pid)).toBeGreaterThan(0)
        } finally {
          release()
        }
        await holder
        await waiter
        expect((await r12Originals(f)).root).toMatchObject({
          currentPeriodCost: '1',
          lastPeriodCost: '20',
          totalCost: '21',
        })
        if (order === 'admit-first')
          expect(
            await api.readFinancialReceipt(
              db,
              f.current.namespace,
              api.occurrenceKey(f.current, lateScopeOccurrence)
            )
          ).toBeNull()
        else
          await tx((bound) =>
            api.releaseProvenUnused(bound, f.current, lateScopeOccurrence, {
              refusedBeforeDelegation: true,
            })
          )
      })
    }
    it(`R12 ${label} concurrent individual admissions serialize against the same surviving pooled hold`, async () => {
      const f = await r12Fixture(api, 'pooled', 'direct', false, '17.5')
      const outcomes = await Promise.allSettled(
        [lateScopeOccurrence, { stepNumber: 2, retryCount: 0 }].map((occurrence) =>
          tx((bound) => api.admitModelStep(bound, f.current, occurrence, true))
        )
      )
      expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((value) => value.status === 'rejected')).toHaveLength(1)
      const refusal = outcomes.find((value) => value.status === 'rejected')
      expect(refusal?.status === 'rejected' && refusal.reason).toMatchObject({ status: 402 })
      for (const occurrence of [lateScopeOccurrence, { stepNumber: 2, retryCount: 0 }]) {
        const op = await api.readFinancialReceipt(
          db,
          f.current.namespace,
          api.occurrenceKey(f.current, occurrence)
        )
        if (op)
          await tx((bound) =>
            api.releaseProvenUnused(bound, f.current, occurrence, { refusedBeforeDelegation: true })
          )
      }
      expect((await r12Originals(f)).operation).toMatchObject({
        holdState: 'outstanding',
        identity: { memberUserId: null, quote: { holdUsd: '17.5' } },
      })
    })
    it(`R12 ${label} new pooled scope retains all actors' original individual holds once`, async () => {
      const f = await organizationFixture(3, 'individual')
      const old = await r12Binding(api, f, '10')
      await tx((bound) => api.admitModelStep(bound, old, firstScopeOccurrence, true))
      const other = await person('r12-reverse-other')
      await adapter.create({
        model: 'member',
        data: { organizationId: f.id, userId: other, role: 'member', createdAt: new Date() },
      })
      await db.insert(tables.permissions).values({
        id: randomUUID(),
        entityType: 'workspace',
        entityId: f.workspaceId,
        userId: other,
        permissionType: 'write',
      })
      const otherOld = await r12Binding(api, { ...f, owner: other }, '10')
      await tx((bound) => api.admitModelStep(bound, otherOld, firstScopeOccurrence, true))
      const [tier] = await db
        .select()
        .from(tables.systemBillingTier)
        .where(eq(tables.systemBillingTier.id, `${f.tag}-tier`))
      const [sub] = await db
        .select()
        .from(tables.subscription)
        .where(eq(tables.subscription.referenceId, f.id))
      const nextTier = `${f.tag}-r12-pooled`
      await db
        .insert(tables.systemBillingTier)
        .values({ ...tier, id: nextTier, usageScope: 'pooled', includedUsageLimitUsd: '7' })
      const { updateFinancialSubscription } = await import('./financial-subscriptions')
      await updateFinancialSubscription(sub.id, {
        plan: nextTier,
        periodStart: new Date('2026-02-01T00:00:00Z'),
        periodEnd: new Date('2026-03-01T00:00:00Z'),
      })
      const current = await r12Binding(api, f, '2')
      await expect(
        tx((bound) => api.admitModelStep(bound, current, firstScopeOccurrence, true))
      ).rejects.toMatchObject({ status: 402 })
      expect(
        await api.readFinancialReceipt(
          db,
          old.namespace,
          api.occurrenceKey(old, firstScopeOccurrence)
        )
      ).toMatchObject({ identity: { memberUserId: f.owner }, holdState: 'outstanding' })
      expect(
        await api.readFinancialReceipt(
          db,
          otherOld.namespace,
          api.occurrenceKey(otherOld, firstScopeOccurrence)
        )
      ).toMatchObject({ identity: { memberUserId: other }, holdState: 'outstanding' })
    })
  }
  // R8 raw exported FINAL package controls run before the retained service cases.
  async function r8OriginalInvoice() {
    const f = await baseInvoiceFixture()
    const invoice = baseInvoice(f, [baseInvoiceLine(f)])
    await (await baseInvoiceEvents(invoice)).finalized()
    const bound = await policy.readSubscriptionInvoice(db, invoice.id as string)
    if (!bound) throw new Error('Actual accepted original invoice required')
    return { ...f, invoice, bound }
  }
  async function r8Raw(candidate: policy.DispatchCandidate) {
    const [row] = await db
      .select({ result: tables.idempotencyKey.result })
      .from(tables.idempotencyKey)
      .where(
        and(
          eq(tables.idempotencyKey.namespace, candidate.namespace),
          eq(tables.idempotencyKey.key, candidate.key)
        )
      )
    if (!row || !row.result || typeof row.result !== 'object' || Array.isArray(row.result))
      throw new Error('Actual original JSON receipt required')
    return row.result as Record<string, unknown>
  }
  async function r8Write(candidate: policy.DispatchCandidate, result: Record<string, unknown>) {
    await db
      .update(tables.idempotencyKey)
      .set({ result })
      .where(
        and(
          eq(tables.idempotencyKey.namespace, candidate.namespace),
          eq(tables.idempotencyKey.key, candidate.key)
        )
      )
  }
  // Capture only the existing configured callback; actual tests call the restored raw FINAL export.
  let r8Execute: policy.FinancialDispatchDrainOptions['execute'] | undefined
  async function r8DefaultExecute() {
    if (r8Execute) return r8Execute
    state.captureDrain = async (_store, options) => {
      r8Execute = options.execute
      return {
        completed: 0,
        uncertain: 0,
        retryable: 0,
        skipped: 0,
        classified: 0,
        integrityUnresolved: 0,
        visited: 0,
      }
    }
    try {
      await (await import('./dispatcher')).dispatchFinancialMarkers()
    } finally {
      state.captureDrain = null
    }
    if (!r8Execute) throw new Error('Actual configured financial callback required')
    return r8Execute
  }
  async function r8ClassifyingDrain(
    candidate: policy.DispatchCandidate,
    options: policy.FinancialDispatchDrainOptions,
    expectedReviews = 1
  ) {
    const visits: Array<Awaited<ReturnType<typeof policy.drainFinancialDispatch>>> = []
    for (let visit = 0; visit < 8; visit++) {
      const result = await policy.drainFinancialDispatch(db, options)
      visits.push(result)
      const review = (await r8Raw(candidate)).dispatchIntegrity
      if (
        review &&
        typeof review === 'object' &&
        'reviews' in review &&
        review.reviews === expectedReviews
      ) {
        console.info('R8_ACTUAL_CLASSIFICATION_VISITS', JSON.stringify({ expectedReviews, visits }))
        return result
      }
    }
    throw new Error(
      `Actual bounded dispatch visits did not classify the original: ${JSON.stringify(visits)}`
    )
  }
  async function r8Fault(patch: (raw: Record<string, unknown>) => void) {
    const original = await invoiceFixture()
    const invoice = {
      id: `in_${randomUUID()}`,
      object: 'invoice',
      status: 'open',
      customer: original.period.customerId,
      currency: original.intent.currency,
      total: centsToProviderNumber(original.intent.amountCents),
      amount_paid: 0,
      attempt_count: 1,
      metadata: {
        type: 'overage_billing',
        financialNamespace: original.candidate.namespace,
        financialKey: original.candidate.key,
        financialFingerprint: original.intent.fingerprint,
        subscriptionId: original.period.stripeSubscriptionId,
        periodStart: original.period.start,
        periodEnd: original.period.end,
      },
    }
    await (await baseInvoiceEvents(invoice)).finalized()
    const intent = await policy.readFinancialReceipt(
      db,
      original.candidate.namespace,
      original.candidate.key
    )
    if (!intent || intent.recordType !== 'invoice')
      throw new Error('Actual original overage required')
    const f = {
      ...original,
      invoice,
      bound: { namespace: original.candidate.namespace, key: original.candidate.key, intent },
    }
    const candidate = { namespace: f.bound.namespace, key: f.bound.key, due: Date.now() - 400001 }
    const raw = structuredClone(f.bound.intent) as unknown as Record<string, unknown>
    Object.assign(raw, {
      dispatchState: 'pending',
      dispatchAtMs: candidate.due,
      markers: [
        {
          id: `original:${f.bound.intent.fingerprint}`,
          kind: 'invoice',
          phase: 'create',
          state: 'pending',
          attempts: 0,
          failedAttempts: 0,
          nextAtMs: candidate.due,
          requestKey: 'incomplete-original-preparation',
        },
      ],
    })
    patch(raw)
    await r8Write(candidate, raw)
    return { ...f, candidate, raw }
  }
  const r8OriginalFacts = (raw: Record<string, unknown>) => {
    const { dispatchIntegrity: _integrity, dispatchAtMs: _due, ...original } = raw
    return original
  }
  it('R8 raw drain classifies original malformed dispatch durably, unblocks only unrelated admission and preserves incurred acceptance', async () => {
    const f = await baseInvoiceFixture()
    const incurred = await scopeBinding(f)
    await tx((bound) => policy.admitModelStep(bound, incurred, firstScopeOccurrence, true))
    const invoice = baseInvoice(f, [baseInvoiceLine(f)])
    await (await baseInvoiceEvents(invoice)).finalized()
    const original = await policy.readSubscriptionInvoice(db, invoice.id as string)
    if (!original) throw new Error('Actual accepted original invoice required')
    const candidate = { namespace: original.namespace, key: original.key, due: Date.now() - 400001 }
    const raw = structuredClone(original.intent) as unknown as Record<string, unknown>
    Object.assign(raw, {
      dispatchState: 'pending',
      dispatchAtMs: candidate.due,
      markers: [
        {
          id: 'original-corrupt-contact',
          kind: 'invoice',
          phase: 'create',
          state: 'pending',
          attempts: 0,
          failedAttempts: 0,
          nextAtMs: candidate.due,
          requestKey: 'incomplete-original-preparation',
        },
      ],
    })
    await r8Write(candidate, raw)
    expect((await policy.probeFinancialBackpressure(db)).blocked).toBe(true)
    let contacts = 0
    const service = await r8DefaultExecute()
    const drained = await policy.drainFinancialDispatch(db, {
      execute: async (claim, deadline) => {
        if (claim.candidate.key === candidate.key) {
          contacts++
          throw new Error('Malformed target cannot contact')
        }
        return service(claim, deadline)
      },
    })
    expect(drained.classified).toBeGreaterThanOrEqual(1)
    expect(contacts).toBe(0)
    const classified = await r8Raw(candidate)
    expect(r8OriginalFacts(classified)).toEqual(r8OriginalFacts(raw))
    expect(classified.dispatchIntegrity).toMatchObject({ reviews: 1 })
    expect((await policy.probeFinancialBackpressure(db)).blocked).toBe(false)
    await expect(scopeBinding(f)).rejects.toMatchObject({ status: 503 })
    await expect(
      tx((bound) => policy.admitModelStep(bound, incurred, lateScopeOccurrence, true))
    ).rejects.toMatchObject({ status: 503 })
    await acceptScopeAmount(incurred, firstScopeOccurrence, '0.3')
    expect(
      await tx((bound) => policy.verifyAcceptance(bound, incurred, firstScopeOccurrence))
    ).toMatchObject({ accepted: true, appliedUsd: '0.3' })
    const healthy = await scopeFixture('individual')
    const healthyBinding = await scopeBinding(healthy)
    await tx((bound) => policy.admitModelStep(bound, healthyBinding, firstScopeOccurrence, true))
    await acceptScopeAmount(healthyBinding, firstScopeOccurrence, '0.1')
    expect(
      await tx((bound) => policy.verifyAcceptance(bound, healthyBinding, firstScopeOccurrence))
    ).toMatchObject({ accepted: true, appliedUsd: '0.1' })
  })
  for (const variant of [
    'missing-due',
    'string-due',
    'large-due',
    'large-next',
    'large-expiry',
    'unsupported-phase',
    'empty-markers',
  ] as const) {
    it(`R8 raw drain preserves original money while classifying ${variant}`, async () => {
      const f = await r8Fault((raw) => {
        if (variant === 'missing-due') Reflect.deleteProperty(raw, 'dispatchAtMs')
        if (variant === 'string-due') raw.dispatchAtMs = 'not-a-time'
        if (variant === 'large-due') raw.dispatchAtMs = 1_000_000_000_000_000
        if (variant === 'large-next')
          (raw.markers as Array<Record<string, unknown>>)[0].nextAtMs = 1_000_000_000_000_000
        if (variant === 'large-expiry')
          Object.assign((raw.markers as Array<Record<string, unknown>>)[0], {
            state: 'claimed',
            attempts: 1,
            claimId: randomUUID(),
            claimExpiresAtMs: 1_000_000_000_000_000,
          })
        if (variant === 'unsupported-phase')
          (raw.markers as Array<Record<string, unknown>>)[0].phase = 'unrecognized-original-phase'
        if (variant === 'empty-markers') raw.markers = []
      })
      let contacts = 0
      const service = await r8DefaultExecute()
      const result = await r8ClassifyingDrain(f.candidate, {
        execute: async (claim, deadline) => {
          if (claim.candidate.key === f.candidate.key) {
            contacts++
            throw new Error('Invalid target cannot contact')
          }
          return service(claim, deadline)
        },
      })
      expect(result.classified).toBeGreaterThanOrEqual(1)
      expect(contacts).toBe(0)
      const after = await r8Raw(f.candidate)
      expect(r8OriginalFacts(after)).toEqual(r8OriginalFacts(f.raw))
      expect(after.financialClosureState).toBe('open')
      expect(after.dispatchState).toBe('pending')
      expect(Number(after.dispatchAtMs)).toBeGreaterThan(Date.now())
      expect((await policy.probeFinancialBackpressure(db)).blocked).toBe(false)
    })
  }
  it('R8 raw drain records eight actual reviews then15-minute review work without renewal before eligibility', async () => {
    const f = await r8Fault(() => {})
    let now = Date.now()
    const execute = await r8DefaultExecute()
    for (let attempt = 1; attempt <= 9; attempt++) {
      await r8ClassifyingDrain(f.candidate, { now: () => now, execute }, attempt)
      const row = await r8Raw(f.candidate)
      const review = row.dispatchIntegrity as policy.DispatchIntegrityReview
      expect(review.reviews).toBe(attempt)
      if (attempt >= 8) expect(review.nextReviewAtMs - now).toBe(900000)
      const before = structuredClone(row)
      await policy.drainFinancialDispatch(db, { now: () => now, execute })
      expect(await r8Raw(f.candidate)).toEqual(before)
      now = review.nextReviewAtMs
    }
    expect(r8OriginalFacts(await r8Raw(f.candidate))).toEqual(r8OriginalFacts(f.raw))
  })
  it('R8 classification fences stale observations and preserves actual paid webhook progress and an active claim', async () => {
    const f = await r8Fault((raw) => {
      ;(raw.markers as Array<Record<string, unknown>>)[0].phase = 'unrecognized-original-phase'
    })
    const observed = policy.financialFingerprint(await r8Raw(f.candidate))
    await (await baseInvoiceEvents(f.invoice)).paid()
    expect(
      (
        await tx((bound) =>
          policy.classifyFinancialDispatch(bound, f.candidate, observed, Date.now())
        )
      ).status
    ).toBe('stale')
    const paid = await r8Raw(f.candidate)
    expect(paid.invoiceObligationState).toBe('closed')
    expect(
      (
        await tx((bound) =>
          policy.classifyFinancialDispatch(
            bound,
            f.candidate,
            policy.financialFingerprint(paid),
            Date.now()
          )
        )
      ).status
    ).toBe('stale')
    const retained = await r8Raw(f.candidate)
    expect(retained).toEqual(paid)
    expect(retained.invoiceObligationState).toBe('closed')
    const other = await r8OriginalInvoice()
    const events = await baseInvoiceEvents(other.invoice)
    await events.failed()
    const candidate = { namespace: other.bound.namespace, key: other.bound.key, due: Date.now() }
    const claim = await tx((bound) => policy.claimFinancialDispatch(bound, candidate, Date.now()))
    if (!claim) throw new Error('Actual current claim required')
    const raw = await r8Raw(candidate)
    raw.dispatchAtMs = 0
    ;(raw.markers as Array<Record<string, unknown>>)[0].phase = 'unrecognized-original-phase'
    await r8Write(candidate, raw)
    expect(
      (
        await tx((bound) =>
          policy.classifyFinancialDispatch(
            bound,
            candidate,
            policy.financialFingerprint(raw),
            Date.now()
          )
        )
      ).status
    ).toBe('busy')
    expect(await r8Raw(candidate)).toEqual(raw)
    expect(
      (
        await tx((bound) =>
          policy.classifyFinancialDispatch(
            bound,
            candidate,
            policy.financialFingerprint(raw),
            claim.marker.claimExpiresAtMs! + 1
          )
        )
      ).status
    ).toBe('classified')
    const classified = await r8Raw(candidate)
    expect((classified.markers as Array<Record<string, unknown>>)[0].claimId).toBe(
      claim.marker.claimId
    )
  })
  it('R8 recovered genuine previous-period closure rechecks and closes its proved financial head', async () => {
    const f = await scopeFixture('individual')
    const binding = await scopeBinding(f)
    const previous = await scopePeriod(binding)
    const service = await r8DefaultExecute()
    await tx((bound) =>
      policy.closeFinancialPeriod(bound, { type: 'organization', id: f.id }, previous)
    )
    await policy.drainFinancialDispatch(db, { execute: service })
    expect(
      await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(previous))
    ).toMatchObject({ financialClosureState: 'closed' })
    const { updateFinancialSubscription } = await import('./financial-subscriptions')
    await updateFinancialSubscription(f.subId, {
      periodStart: new Date('2026-02-01T00:00:00Z'),
      periodEnd: new Date('2026-03-01T00:00:00Z'),
    })
    const candidate = { namespace: ns(f.id), key: policy.periodKey(previous), due: 0 }
    const raw = await r8Raw(candidate)
    Object.assign(raw, { dispatchState: 'pending', dispatchAtMs: -1 })
    await r8Write(candidate, raw)
    expect(
      (
        await tx((bound) =>
          policy.classifyFinancialDispatch(
            bound,
            candidate,
            policy.financialFingerprint(raw),
            Date.now()
          )
        )
      ).status
    ).toBe('classified')
    const [head] = await db
      .select({ result: tables.idempotencyKey.result })
      .from(tables.idempotencyKey)
      .where(
        and(
          eq(tables.idempotencyKey.namespace, ns(f.id)),
          eq(tables.idempotencyKey.key, 'period-head')
        )
      )
    const current = (head.result as { current: policy.Period }).current
    await tx((bound) =>
      policy.closeFinancialPeriod(bound, { type: 'organization', id: f.id }, current)
    )
    await policy.drainFinancialDispatch(db, { execute: service })
    expect(await policy.readFinancialReceipt(db, ns(f.id), 'period-head')).toMatchObject({
      financialClosureState: 'open',
    })
    const held = await r8Raw(candidate)
    const review = held.dispatchIntegrity as policy.DispatchIntegrityReview
    expect(
      (
        await tx((bound) =>
          policy.classifyFinancialDispatch(
            bound,
            candidate,
            policy.financialFingerprint(held),
            review.nextReviewAtMs
          )
        )
      ).status
    ).toBe('recovered')
    expect(await policy.readFinancialReceipt(db, ns(f.id), candidate.key)).toMatchObject({
      financialClosureState: 'closed',
    })
    expect(await policy.readFinancialReceipt(db, ns(f.id), 'period-head')).toMatchObject({
      financialClosureState: 'closed',
    })
  })
  it('R8 raw drain passes the100-head page boundary to healthy genuine suppressed notices while preserving the malformed oldest obligation', async () => {
    const bad = await r8Fault(() => {})
    const healthy = await baseInvoiceFixture()
    const notices: Array<{ namespace: string; key: string }> = []
    for (let i = 0; i < 101; i++) {
      const invoice = baseInvoice(healthy, [baseInvoiceLine(healthy)], { total: 100 + i })
      const events = await baseInvoiceEvents(invoice)
      await events.failed()
      const source = await policy.readSubscriptionInvoice(db, invoice.id as string)
      if (!source) throw new Error('Genuine original debt required')
      notices.push(
        await tx((bound) =>
          policy.createFinancialNotification(bound, {
            namespace: source.namespace,
            sourceKey: source.key,
            recipientUserId: healthy.owner,
            notificationKind: 'payment-failed',
          })
        )
      )
      await events.paid()
    }
    expect(await policy.listFinancialDispatch(db, Date.now(), undefined, 100)).toHaveLength(100)
    let active = 0
    let maximum = 0
    const execute = await r8DefaultExecute()
    let processed = 0
    const visits: Array<Awaited<ReturnType<typeof policy.drainFinancialDispatch>>> = []
    for (let visit = 0; visit < notices.length * 2 + 4; visit++) {
      const result = await policy.drainFinancialDispatch(db, {
        execute: async (claim, deadline) => {
          if (claim.candidate.key === bad.candidate.key)
            throw new Error('Malformed target cannot execute')
          active++
          maximum = Math.max(maximum, active)
          try {
            return await execute(claim, deadline)
          } finally {
            active--
            processed++
          }
        },
      })
      visits.push(result)
      expect(result.visited).toBeGreaterThan(0)
      expect(result.completed + result.classified).toBeGreaterThan(0)
      const left = await Promise.all(
        notices.map((x) => policy.readFinancialReceipt(db, x.namespace, x.key))
      )
      if (left.every((x) => x && 'dispatchState' in x && x.dispatchState === 'complete')) break
    }
    console.info('R8_ACTUAL_PAGE_VISITS', JSON.stringify(visits))
    expect(maximum).toBeLessThanOrEqual(4)
    expect(active).toBe(0)
    expect(processed).toBeGreaterThan(100)
    for (const notice of notices)
      expect(await policy.readFinancialReceipt(db, notice.namespace, notice.key)).toMatchObject({
        dispatchState: 'complete',
      })
    expect((await r8Raw(bad.candidate)).invoiceObligationState).toBe('open')
    expect((await r8Raw(bad.candidate)).dispatchIntegrity).toBeDefined()
    expect((await policy.probeFinancialBackpressure(db)).blocked).toBe(false)
  }, 45000)

  for (const usageScope of ['pooled', 'individual'] as const) {
    it(`settles admitted ${usageScope} organization occurrences against the original current frozen basis after actual SDK cancellation`, async () => {
      const f = await organizationFixture(3, usageScope)
      const binding = await tx((bound) =>
        policy.createInvocation(bound, {
          actorUserId: f.owner,
          workspaceId: f.workspaceId,
          runId: randomUUID(),
          operationKey: randomUUID(),
          purpose: 'copilot',
          quotedHoldUsd: '0.1',
          schedulerReady: true,
        })
      )
      const first = { stepNumber: 0, retryCount: 0 }
      const second = { stepNumber: 1, retryCount: 0 }
      for (const occurrence of [first, second])
        await tx((bound) => policy.admitModelStep(bound, binding, occurrence, true))
      const invocation = await policy.readFinancialReceipt(db, binding.namespace, binding.key)
      if (invocation?.recordType !== 'invocation' || !invocation.identity.period)
        throw new Error('Actual invocation lacks original period')
      const original = invocation.identity.period
      await adapter.update({
        model: 'subscription',
        where: [{ field: 'id', value: original.subscriptionId }],
        update: { status: 'canceled', periodEnd: new Date('2026-01-20T00:00:00Z') },
      })
      const frozen = await policy.readFinancialReceipt(
        db,
        binding.namespace,
        policy.periodKey(original)
      )
      expect(frozen?.recordType === 'period' && frozen.closing).toMatchObject({
        mode: usageScope,
        acceptedUsd: '0',
        memberUsd: usageScope === 'individual' ? { [f.owner]: '0' } : {},
      })
      expect(
        await db
          .select()
          .from(tables.subscription)
          .where(
            and(eq(tables.subscription.referenceId, f.id), eq(tables.subscription.status, 'active'))
          )
      ).toHaveLength(0)
      await expect(
        tx((bound) => policy.admitModelStep(bound, binding, { stepNumber: 2, retryCount: 0 }, true))
      ).rejects.toThrow()
      await expect(
        tx((bound) =>
          policy.createInvocation(bound, {
            actorUserId: f.owner,
            workspaceId: f.workspaceId,
            runId: randomUUID(),
            operationKey: randomUUID(),
            purpose: 'copilot',
            schedulerReady: true,
          })
        )
      ).rejects.toThrow()

      const amount = '0.30000000000000001'
      const input = { permittedProductUsd: amount, usage: { totalTokens: 7 } }
      await rollbackProbe(async (bound) => {
        await bound
          .delete(tables.idempotencyKey)
          .where(
            and(
              eq(tables.idempotencyKey.namespace, binding.namespace),
              eq(tables.idempotencyKey.key, policy.periodKey(original))
            )
          )
        await expect(policy.acceptModelStep(bound, binding, first, input)).rejects.toThrow(
          'basis is missing'
        )
      })
      await rollbackProbe(async (bound) => {
        await bound
          .delete(tables.organizationMemberBillingLedger)
          .where(
            and(
              eq(tables.organizationMemberBillingLedger.organizationId, f.id),
              eq(tables.organizationMemberBillingLedger.userId, f.owner)
            )
          )
        await expect(policy.acceptModelStep(bound, binding, first, input)).rejects.toThrow(
          'missing'
        )
      })
      await rollbackProbe(async (bound) => {
        await policy.acceptModelStep(bound, binding, first, input)
        expect((await policy.verifyAcceptance(bound, binding, first)).appliedUsd).toBe(amount)
      })
      const outstanding = await policy.readFinancialReceipt(
        db,
        binding.namespace,
        policy.occurrenceKey(binding, first)
      )
      expect(outstanding).toMatchObject({
        recordType: 'operation',
        contactState: 'uncertain',
        holdState: 'outstanding',
      })
      expect((await ledger(f.id, f.owner)).totalCost).toBe('0')

      const accepted = await Promise.all(
        [0, 1].map(() => tx((bound) => policy.acceptModelStep(bound, binding, first, input)))
      )
      expect(accepted[0]).toEqual(accepted[1])
      await tx((bound) =>
        policy.acceptModelStep(bound, binding, second, {
          permittedProductUsd: '0.2',
          usage: { totalTokens: 3 },
        })
      )
      await expect(
        tx((bound) => policy.acceptModelStep(bound, binding, first, { permittedProductUsd: '0.4' }))
      ).rejects.toThrow('intent was changed')
      const total = '0.50000000000000001'
      const [payer] = await db
        .select()
        .from(tables.organizationBillingLedger)
        .where(eq(tables.organizationBillingLedger.organizationId, f.id))
      for (const actual of usageScope === 'individual'
        ? [payer, await ledger(f.id, f.owner)]
        : [payer])
        expect(actual).toMatchObject({
          totalCost: total,
          currentPeriodCost: total,
          lastPeriodCost: '0',
          totalCopilotCost: total,
          currentPeriodCopilotCost: total,
          lastPeriodCopilotCost: '0',
          totalTokensUsed: 10,
          totalCopilotTokens: 10,
          totalCopilotCalls: 2,
        })
      const basis = await policy.readFinancialReceipt(
        db,
        binding.namespace,
        policy.periodKey(original)
      )
      expect(basis?.recordType === 'period' && basis.closing).toMatchObject({
        acceptedUsd: total,
        copilotUsd: total,
        memberUsd: usageScope === 'individual' ? { [f.owner]: total } : {},
        mode: usageScope,
      })
      expect(await policy.readFinancialReceipt(db, binding.namespace, 'period-head')).toMatchObject(
        { recordType: 'period-head', current: original, previous: null }
      )
      for (const [occurrence, appliedUsd] of [
        [first, amount],
        [second, '0.2'],
      ] as const) {
        expect(
          await tx((bound) => policy.verifyAcceptance(bound, binding, occurrence))
        ).toMatchObject({ accepted: true, appliedUsd })
        expect(
          await policy.readFinancialReceipt(
            db,
            binding.namespace,
            policy.occurrenceKey(binding, occurrence)
          )
        ).toMatchObject({
          recordType: 'operation',
          binding,
          contactState: 'accepted',
          holdState: 'closed',
          appliedUsd,
          identity: {
            root: { type: 'organization', id: f.id },
            memberUserId: usageScope === 'individual' ? f.owner : null,
            period: original,
          },
        })
      }
    })
  }

  it('allows actual authorized pristine organization DELETE and preserves authentic closed provenance without creating a period', async () => {
    const f = await pristineOrganizationFixture()
    const before = await db
      .select()
      .from(tables.idempotencyKey)
      .where(eq(tables.idempotencyKey.namespace, ns(f.id)))
      .orderBy(tables.idempotencyKey.key)
    expect(before).toHaveLength(2)
    await tx((bound) => policy.assertFinancialRootClosed(bound, { type: 'organization', id: f.id }))
    state.session = null
    const { DELETE } = await import('@/app/api/organizations/[id]/route')
    const request = () =>
      new Request('http://127.0.0.1/api/organization', { method: 'DELETE' }) as never
    expect((await DELETE(request(), { params: Promise.resolve({ id: f.id }) })).status).toBe(401)
    const outsider = await person('pristine-outsider')
    state.session = { user: { id: outsider, email: `${outsider}@invalid.test` } }
    expect((await DELETE(request(), { params: Promise.resolve({ id: f.id }) })).status).toBe(403)
    state.session = { user: { id: f.owner, email: `${f.owner}@invalid.test` } }
    const response = await DELETE(request(), { params: Promise.resolve({ id: f.id }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(
      await db.select().from(tables.organization).where(eq(tables.organization.id, f.id))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(tables.organizationBillingLedger)
        .where(eq(tables.organizationBillingLedger.organizationId, f.id))
    ).toHaveLength(0)
    expect(await ledger(f.id, f.owner)).toBeUndefined()
    expect(
      asJson(
        await db
          .select()
          .from(tables.idempotencyKey)
          .where(eq(tables.idempotencyKey.namespace, ns(f.id)))
          .orderBy(tables.idempotencyKey.key)
      )
    ).toEqual(asJson(before))
    expect(await policy.readFinancialReceipt(db, ns(f.id), 'period-head')).toBeNull()
  })

  it('refuses incomplete, corrupt, nonzero, blocked or unclassified pristine evidence without repair', async () => {
    const f = await pristineOrganizationFixture()
    const registration = await pair(f.id, f.owner)
    const registry = await policy.readFinancialReceipt(db, ns(f.id), policy.memberRegistryKey)
    if (
      registration?.recordType !== 'member-registration' ||
      registry?.recordType !== 'member-registry'
    )
      throw new Error('Actual creation provenance missing')
    const receiptWhere = (key: string) =>
      and(eq(tables.idempotencyKey.namespace, ns(f.id)), eq(tables.idempotencyKey.key, key))
    const refuse = async (mutate: (bound: policy.FinancialTransaction) => Promise<unknown>) =>
      rollbackProbe(async (bound) => {
        await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
        await mutate(bound)
        await expect(
          policy.assertFinancialRootClosed(bound, { type: 'organization', id: f.id })
        ).rejects.toThrow()
      })
    await refuse((bound) =>
      bound.delete(tables.idempotencyKey).where(receiptWhere(policy.memberRegistryKey))
    )
    await refuse((bound) =>
      bound.delete(tables.idempotencyKey).where(receiptWhere(policy.memberRegistrationKey(f.owner)))
    )
    await refuse((bound) =>
      bound
        .delete(tables.organizationMemberBillingLedger)
        .where(eq(tables.organizationMemberBillingLedger.organizationId, f.id))
    )
    await refuse((bound) =>
      bound
        .update(tables.idempotencyKey)
        .set({ result: { ...registration, ledgerAnchor: 'corrupt' } })
        .where(receiptWhere(policy.memberRegistrationKey(f.owner)))
    )
    await refuse((bound) =>
      bound
        .update(tables.idempotencyKey)
        .set({
          result: { ...registry, provenance: { ...registry.provenance, digest: '0'.repeat(64) } },
        })
        .where(receiptWhere(policy.memberRegistryKey))
    )
    await refuse((bound) =>
      bound
        .update(tables.idempotencyKey)
        .set({ result: { ...registry, dispatchState: 'pending' } })
        .where(receiptWhere(policy.memberRegistryKey))
    )
    await refuse((bound) =>
      bound
        .update(tables.idempotencyKey)
        .set({ result: { ...registry, debtUsd: '0' } })
        .where(receiptWhere(policy.memberRegistryKey))
    )
    for (const patch of [
      { totalCost: '0.00000000000000001' },
      { currentPeriodCost: '0.1' },
      { lastPeriodCost: '0.1' },
      { totalCopilotCost: '0.1' },
      { currentPeriodCopilotCost: '0.1' },
      { lastPeriodCopilotCost: '0.1' },
      { totalTokensUsed: 1 },
      { totalCopilotTokens: 1 },
      { totalCopilotCalls: 1 },
      { totalManualExecutions: 1 },
      { totalApiCalls: 1 },
      { totalWebhookTriggers: 1 },
      { totalScheduledExecutions: 1 },
      { totalChatExecutions: 1 },
    ]) {
      await refuse((bound) =>
        bound
          .update(tables.organizationBillingLedger)
          .set(patch)
          .where(eq(tables.organizationBillingLedger.organizationId, f.id))
      )
      await refuse((bound) =>
        bound
          .update(tables.organizationMemberBillingLedger)
          .set(patch)
          .where(eq(tables.organizationMemberBillingLedger.organizationId, f.id))
      )
    }
    await refuse((bound) =>
      bound
        .update(tables.organizationBillingLedger)
        .set({ billingBlocked: true })
        .where(eq(tables.organizationBillingLedger.organizationId, f.id))
    )
    await refuse((bound) =>
      bound
        .update(tables.organizationBillingLedger)
        .set({ billedOverageThisPeriod: '0.1' })
        .where(eq(tables.organizationBillingLedger.organizationId, f.id))
    )
    for (const result of [
      { recordType: 'unknown', financialClosureState: 'closed', dispatchState: 'complete' },
      {
        recordType: 'operation',
        financialClosureState: 'closed',
        dispatchState: 'complete',
        holdState: 'closed',
      },
      { recordType: 'operation', holdState: 'outstanding' },
      { recordType: 'invoice', invoiceObligationState: 'open' },
      { recordType: 'reconciliation' },
    ])
      await refuse((bound) =>
        bound
          .insert(tables.idempotencyKey)
          .values({ key: `controlled-corruption:${randomUUID()}`, namespace: ns(f.id), result })
      )
    await tx((bound) => policy.assertFinancialRootClosed(bound, { type: 'organization', id: f.id }))
    expect(await pair(f.id, f.owner)).toEqual(registration)
    expect(await policy.readFinancialReceipt(db, ns(f.id), policy.memberRegistryKey)).toEqual(
      registry
    )
    expect(await policy.readFinancialReceipt(db, ns(f.id), 'period-head')).toBeNull()
  })

  it('serializes pristine deletion against a genuine waiting member registration without recreating deleted targets', async () => {
    const f = await pristineOrganizationFixture()
    const joiner = await person('pristine-waiter')
    const registration = await pair(f.id, f.owner)
    let announce!: () => void
    let release!: () => void
    const locked = new Promise<void>((resolve) => {
      announce = resolve
    })
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    const deleting = db.transaction(async (bound) => {
      await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
      await policy.assertFinancialRootClosed(bound, { type: 'organization', id: f.id })
      announce()
      await resume
      await bound.delete(tables.organization).where(eq(tables.organization.id, f.id))
    })
    await locked
    const waiting = adapter.create({
      model: 'member',
      data: { organizationId: f.id, userId: joiner, role: 'member', createdAt: new Date() },
    })
    const refused = expect(waiting).rejects.toThrow()
    release()
    await deleting
    await refused
    expect(await ledger(f.id, joiner)).toBeUndefined()
    expect(await pair(f.id, joiner)).toBeNull()
    expect(await pair(f.id, f.owner)).toEqual(registration)
  })

  for (const usageScope of ['pooled', 'individual'] as const) {
    it(`refuses a departed ${usageScope} actor's new occurrence despite retained workspace access and pays admitted original obligations`, async () => {
      const f = await organizationFixture(3, usageScope)
      const actor = await person('departing-actor')
      const join = () =>
        adapter.create<{ id: string }>({
          model: 'member',
          data: { organizationId: f.id, userId: actor, role: 'member', createdAt: new Date() },
        })
      let membership = await join()
      await db.insert(tables.permissions).values({
        id: randomUUID(),
        entityType: 'workspace',
        entityId: f.workspaceId,
        userId: actor,
        permissionType: 'read',
      })
      const binding = await tx((bound) =>
        policy.createInvocation(bound, {
          actorUserId: actor,
          workspaceId: f.workspaceId,
          runId: randomUUID(),
          operationKey: randomUUID(),
          purpose: 'copilot',
          quotedHoldUsd: '0.1',
          schedulerReady: true,
        })
      )
      const first = { stepNumber: 0, retryCount: 0 }
      const second = { stepNumber: 1, retryCount: 0 }
      const third = { stepNumber: 2, retryCount: 0 }
      await tx((bound) => policy.admitModelStep(bound, binding, first, true))
      const originalHold = await policy.readFinancialReceipt(
        db,
        binding.namespace,
        policy.occurrenceKey(binding, first)
      )
      const registration = await pair(f.id, actor)
      await adapter.delete({ model: 'member', where: [{ field: 'id', value: membership.id }] })
      const refused = await tx((bound) => policy.admitModelStep(bound, binding, second, true)).then(
        () => null,
        (error) => error
      )
      expect(refused).toBeInstanceOf(policy.FinancialPolicyError)
      expect(refused.status).toBe(403)
      expect(
        await policy.readFinancialReceipt(
          db,
          binding.namespace,
          policy.occurrenceKey(binding, second)
        )
      ).toBeNull()
      expect(
        await policy.readFinancialReceipt(
          db,
          binding.namespace,
          policy.occurrenceKey(binding, first)
        )
      ).toEqual(originalHold)
      expect(
        await db
          .select()
          .from(tables.permissions)
          .where(
            and(
              eq(tables.permissions.entityId, f.workspaceId),
              eq(tables.permissions.userId, actor)
            )
          )
      ).toHaveLength(1)
      await expect(
        tx((bound) => policy.admitModelStep(bound, binding, first, true))
      ).rejects.toThrow('already been admitted')
      membership = await join()
      expect(await pair(f.id, actor)).toEqual(registration)
      await tx((bound) => policy.admitModelStep(bound, binding, second, true))
      await adapter.delete({ model: 'member', where: [{ field: 'id', value: membership.id }] })
      await expect(
        tx((bound) => policy.admitModelStep(bound, binding, third, true))
      ).rejects.toThrow('not in the organization')
      expect(
        await policy.readFinancialReceipt(
          db,
          binding.namespace,
          policy.occurrenceKey(binding, third)
        )
      ).toBeNull()
      const invocation = await policy.readFinancialReceipt(db, binding.namespace, binding.key)
      if (invocation?.recordType !== 'invocation' || !invocation.identity.period)
        throw new Error('Original admitted period required')
      await adapter.update({
        model: 'subscription',
        where: [{ field: 'id', value: invocation.identity.period.subscriptionId }],
        update: { status: 'canceled', periodEnd: new Date('2026-01-20T00:00:00Z') },
      })
      for (const [occurrence, amount] of [
        [first, '0.2'],
        [second, '0.3'],
      ] as const) {
        const accepted = await tx((bound) =>
          policy.acceptModelStep(bound, binding, occurrence, {
            permittedProductUsd: amount,
            usage: { totalTokens: 7 },
          })
        )
        expect(
          await tx((bound) =>
            policy.acceptModelStep(bound, binding, occurrence, {
              permittedProductUsd: amount,
              usage: { totalTokens: 7 },
            })
          )
        ).toEqual(accepted)
        expect(
          await tx((bound) => policy.verifyAcceptance(bound, binding, occurrence))
        ).toMatchObject({ accepted: true, appliedUsd: amount })
      }
      const [payer] = await db
        .select()
        .from(tables.organizationBillingLedger)
        .where(eq(tables.organizationBillingLedger.organizationId, f.id))
      expect(payer).toMatchObject({
        totalCost: '0.5',
        currentPeriodCost: '0.5',
        totalCopilotCalls: 2,
        totalTokensUsed: 14,
      })
      expect(await ledger(f.id, actor)).toMatchObject({
        totalCost: usageScope === 'individual' ? '0.5' : '0',
        totalCopilotCalls: usageScope === 'individual' ? 2 : 0,
      })
      expect(await pair(f.id, actor)).toEqual(registration)
    })
  }

  it('serializes actual member DELETE after an earlier payer reassignment and retains the liable workspace owner', async () => {
    const f = await memberOwnedWorkspaceFixture()
    const { updateWorkspaceFinancialBinding } = await import('@/lib/workspaces/billing-owner')
    const { DELETE } = await import('@/app/api/organizations/[id]/members/[memberId]/route')
    let announce!: (pid: number) => void
    let release!: () => void
    const locked = new Promise<number>((resolve) => {
      announce = resolve
    })
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = db.transaction(async (bound) => {
      await bound
        .select()
        .from(tables.workspace)
        .where(eq(tables.workspace.id, f.workspaceId))
        .for('update')
      const [row] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
      if (typeof row.pid !== 'number') throw new Error('Owned fixture session identity missing')
      announce(row.pid)
      await resume
    })
    const blocker = await locked
    const assigning = Promise.allSettled([
      updateWorkspaceFinancialBinding({
        actingUserId: f.owner,
        workspaceId: f.workspaceId,
        billingOwner: { type: 'organization', organizationId: f.id },
      }),
    ])
    let deleting: Promise<Response> | undefined
    try {
      const assignmentPid = await waitForBlockedSession(blocker)
      deleting = DELETE(new Request('http://127.0.0.1/api/member', { method: 'DELETE' }) as never, {
        params: Promise.resolve({ id: f.id, memberId: f.workspaceOwnerId }),
      })
      await waitForBlockedSession(assignmentPid)
    } finally {
      release()
      const settled = await Promise.allSettled([holder, assigning, ...(deleting ? [deleting] : [])])
      expect(settled[0].status).toBe('fulfilled')
    }
    const [assignment] = await assigning
    expect(assignment.status).toBe('fulfilled')
    if (!deleting) throw new Error('Actual member DELETE was not started')
    const response = await deleting
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Workspace owner must reassign billing before leaving the organization',
    })
    expect(
      await db
        .select()
        .from(tables.member)
        .where(
          and(eq(tables.member.organizationId, f.id), eq(tables.member.userId, f.workspaceOwnerId))
        )
    ).toHaveLength(1)
    expect(
      (await db.select().from(tables.workspace).where(eq(tables.workspace.id, f.workspaceId)))[0]
    ).toMatchObject({ billingOwnerType: 'organization', billingOwnerOrganizationId: f.id })
  })

  it('serializes actual payer reassignment after an earlier member DELETE and refuses the departed workspace owner', async () => {
    const f = await memberOwnedWorkspaceFixture()
    const { updateWorkspaceFinancialBinding } = await import('@/lib/workspaces/billing-owner')
    const { DELETE } = await import('@/app/api/organizations/[id]/members/[memberId]/route')
    let announce!: (pid: number) => void
    let release!: () => void
    const locked = new Promise<number>((resolve) => {
      announce = resolve
    })
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = db.transaction(async (bound) => {
      await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
      const [row] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
      if (typeof row.pid !== 'number') throw new Error('Owned fixture session identity missing')
      announce(row.pid)
      await resume
    })
    const blocker = await locked
    const deleting = DELETE(
      new Request('http://127.0.0.1/api/member', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ id: f.id, memberId: f.workspaceOwnerId }) }
    )
    let assigning: Promise<PromiseSettledResult<unknown>[]> | undefined
    try {
      const deletingPid = await waitForBlockedSession(blocker)
      assigning = Promise.allSettled([
        updateWorkspaceFinancialBinding({
          actingUserId: f.owner,
          workspaceId: f.workspaceId,
          billingOwner: { type: 'organization', organizationId: f.id },
        }),
      ])
      await waitForBlockedSession(deletingPid)
    } finally {
      release()
      const settled = await Promise.allSettled([
        holder,
        deleting,
        ...(assigning ? [assigning] : []),
      ])
      expect(settled[0].status).toBe('fulfilled')
    }
    expect((await deleting).status).toBe(200)
    if (!assigning) throw new Error('Actual payer reassignment was not started')
    const [assignment] = await assigning
    expect(assignment.status).toBe('rejected')
    if (assignment.status !== 'rejected')
      throw new Error('Departed workspace owner was assigned organization billing')
    expect(assignment.reason.message).toBe(
      'Workspace owner must belong to the billing organization'
    )
    expect(
      await db
        .select()
        .from(tables.member)
        .where(
          and(eq(tables.member.organizationId, f.id), eq(tables.member.userId, f.workspaceOwnerId))
        )
    ).toHaveLength(0)
    expect(
      (await db.select().from(tables.workspace).where(eq(tables.workspace.id, f.workspaceId)))[0]
    ).toMatchObject({
      billingOwnerType: 'user',
      billingOwnerUserId: f.workspaceOwnerId,
      billingOwnerOrganizationId: null,
    })
  })

  it('accepts an existing user through the actual invitation route after financial history, then reuses exact retained money on rejoin', async () => {
    const f = await organizationFixture()
    const joiner = await person('joiner')
    await cost(f)
    const invitationId = randomUUID()
    const email = `${joiner}@invalid.test`
    await db.insert(tables.invitation).values({
      id: invitationId,
      organizationId: f.id,
      email,
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      inviterId: f.owner,
    })
    state.session = { user: { id: joiner, email } }
    const { PUT } = await import('@/app/api/organizations/[id]/invitations/[invitationId]/route')
    const response = await PUT(
      new Request('http://127.0.0.1/api/invitation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' }),
      }) as never,
      { params: Promise.resolve({ id: f.id, invitationId }) }
    )
    expect(response.status).toBe(200)
    expect((await pair(f.id, joiner))?.recordType).toBe('member-registration')
    expect((await ledger(f.id, joiner)).totalCost).toBe('0')
    await db.insert(tables.permissions).values({
      id: randomUUID(),
      entityType: 'workspace',
      entityId: f.workspaceId,
      userId: joiner,
      permissionType: 'read',
    })
    await cost(f, joiner, '0.2')
    const before = asJson(await ledger(f.id, joiner))
    const registration = await pair(f.id, joiner)
    const [membership] = await db
      .select()
      .from(tables.member)
      .where(and(eq(tables.member.organizationId, f.id), eq(tables.member.userId, joiner)))
    await adapter.delete({ model: 'member', where: [{ field: 'id', value: membership.id }] })
    expect(asJson(await ledger(f.id, joiner))).toEqual(before)
    await adapter.create({
      model: 'member',
      data: { organizationId: f.id, userId: joiner, role: 'member', createdAt: new Date() },
    })
    expect(asJson(await ledger(f.id, joiner))).toEqual(before)
    expect(await pair(f.id, joiner)).toEqual(registration)
    expect(before.totalCopilotTokens).toBe(7)
    expect(
      (await db.select().from(tables.userStats).where(eq(tables.userStats.userId, joiner)))[0]
        .grantedOnboardingAllowanceUsd
    ).toBe('0.3')
  })

  it('serializes concurrent SDK first joins and rolls capacity failure back across membership, registration and ledger', async () => {
    const f = await organizationFixture(2)
    const joiner = await person('concurrent')
    const excess = await person('excess')
    const rows = await Promise.all(
      [0, 1].map(() =>
        adapter.create<{ id: string }>({
          model: 'member',
          data: { organizationId: f.id, userId: joiner, role: 'member', createdAt: new Date() },
        })
      )
    )
    expect(rows[0].id).toBe(rows[1].id)
    expect(
      await db
        .select()
        .from(tables.member)
        .where(and(eq(tables.member.organizationId, f.id), eq(tables.member.userId, joiner)))
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(tables.organizationMemberBillingLedger)
        .where(
          and(
            eq(tables.organizationMemberBillingLedger.organizationId, f.id),
            eq(tables.organizationMemberBillingLedger.userId, joiner)
          )
        )
    ).toHaveLength(1)
    await expect(
      adapter.create({
        model: 'member',
        data: { organizationId: f.id, userId: excess, role: 'member', createdAt: new Date() },
      })
    ).rejects.toThrow('licensed capacity')
    expect(await pair(f.id, excess)).toBeNull()
    expect(await ledger(f.id, excess)).toBeUndefined()
    expect(
      await db
        .select()
        .from(tables.member)
        .where(and(eq(tables.member.organizationId, f.id), eq(tables.member.userId, excess)))
    ).toHaveLength(0)
  })

  it('refuses missing historical ledgers, orphan ledgers, coverage and malformed immutable proofs without repair', async () => {
    const f = await organizationFixture()
    const fresh = await person('orphan')
    const original = await pair(f.id, f.owner)
    await rollbackProbe(async (bound) => {
      await bound
        .update(tables.organizationMemberBillingLedger)
        .set({ totalCost: '-0.2' })
        .where(
          and(
            eq(tables.organizationMemberBillingLedger.organizationId, f.id),
            eq(tables.organizationMemberBillingLedger.userId, f.owner)
          )
        )
      await expect(policy.readFinancialMemberTarget(bound, f.id, f.owner)).rejects.toThrow(
        'money is invalid'
      )
    })
    await rollbackProbe(async (bound) => {
      await bound
        .delete(tables.organizationBillingLedger)
        .where(eq(tables.organizationBillingLedger.organizationId, f.id))
      await expect(policy.readFinancialMemberTarget(bound, f.id, f.owner)).rejects.toThrow(
        'organization ledger is missing'
      )
    })
    await rollbackProbe(async (bound) => {
      await bound
        .delete(tables.organizationMemberBillingLedger)
        .where(
          and(
            eq(tables.organizationMemberBillingLedger.organizationId, f.id),
            eq(tables.organizationMemberBillingLedger.userId, f.owner)
          )
        )
      await expect(policy.readFinancialMemberTarget(bound, f.id, f.owner)).rejects.toThrow(
        'missing'
      )
      await expect(policy.assertFinancialMemberTargets(bound, f.id)).rejects.toThrow('incomplete')
    })
    await rollbackProbe(async (bound) => {
      await bound
        .insert(tables.organizationMemberBillingLedger)
        .values({ organizationId: f.id, userId: fresh })
      await expect(
        policy.registerFinancialMember(bound, { organizationId: f.id, userId: fresh }, () =>
          bound
            .insert(tables.member)
            .values({ id: randomUUID(), organizationId: f.id, userId: fresh, role: 'member' })
        )
      ).rejects.toThrow('missing')
    })
    await rollbackProbe(async (bound) => {
      await bound
        .delete(tables.idempotencyKey)
        .where(
          and(
            eq(tables.idempotencyKey.namespace, ns(f.id)),
            eq(tables.idempotencyKey.key, policy.memberRegistryKey)
          )
        )
      await expect(
        policy.registerFinancialMember(
          bound,
          { organizationId: f.id, userId: fresh },
          async () => {}
        )
      ).rejects.toThrow('registry')
    })
    await rollbackProbe(async (bound) => {
      await bound
        .update(tables.idempotencyKey)
        .set({ result: { ...original, ledgerAnchor: 'wrong' } })
        .where(
          and(
            eq(tables.idempotencyKey.namespace, ns(f.id)),
            eq(tables.idempotencyKey.key, policy.memberRegistrationKey(f.owner))
          )
        )
      await expect(policy.readFinancialMemberTarget(bound, f.id, f.owner)).rejects.toThrow('anchor')
    })
    expect(await pair(f.id, f.owner)).toEqual(original)
    await expect(
      tx((bound) => policy.initializeFinancialMemberRegistry(bound, f.id, async () => {}))
    ).rejects.toThrow('not genuinely new')
  })

  it('proves full offline preservation including a closing-only retained member and refuses unknown or changed authoritative money', async () => {
    const owner = await person('preserved-owner')
    const historical = await person('closing-only')
    const org = randomUUID()
    const sub = randomUUID()
    const tier = randomUUID()
    await db
      .insert(tables.organization)
      .values({ id: org, name: 'Disposable preserved root', slug: org })
    await db
      .insert(tables.organizationBillingLedger)
      .values({ organizationId: org, totalCost: '0.2', lastPeriodCost: '0.2' })
    await db
      .insert(tables.member)
      .values({ id: randomUUID(), organizationId: org, userId: owner, role: 'owner' })
    await db.insert(tables.organizationMemberBillingLedger).values([
      { organizationId: org, userId: owner },
      {
        organizationId: org,
        userId: historical,
        totalCost: '0.2',
        lastPeriodCost: '0.2',
        totalCopilotTokens: 9,
      },
    ])
    const period = {
      subscriptionId: sub,
      stripeSubscriptionId: `sub_${sub}`,
      customerId: `cus_${org}`,
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-02-01T00:00:00.000Z',
    }
    await tx((bound) =>
      policy.writeFinancialReceipt(bound, ns(org), policy.periodKey(period), {
        recordType: 'period',
        root: { type: 'organization', id: org },
        period,
        commitments: { issuedUsd: '0', pendingUsd: '0' },
        closing: {
          acceptedUsd: '0.2',
          copilotUsd: '0',
          memberUsd: { [historical]: '0.2' },
          allowanceUsd: '20',
          mode: 'individual',
          frozenAt: new Date().toISOString(),
        },
        invoicePrefix: `invoice:${policy.financialFingerprint(period)}:`,
        financialClosureState: 'closed',
        dispatchState: 'complete',
        dispatchAtMs: 0,
        markers: [],
      })
    )
    const expectedLedgers = asJson(
      await db
        .select()
        .from(tables.organizationMemberBillingLedger)
        .where(eq(tables.organizationMemberBillingLedger.organizationId, org))
        .orderBy(tables.organizationMemberBillingLedger.userId)
    )
    const sourceJson = JSON.stringify(expectedLedgers)
    const sourceDigest = createHash('sha256').update(sourceJson).digest('hex')
    const sourceReference = `disposable-authoritative-ledger-source:${org}`
    const preserve = (rows = expectedLedgers, bound?: policy.FinancialTransaction) => {
      const run = (client: policy.FinancialTransaction) =>
        policy.preserveFinancialMemberRegistry(client, {
          organizationId: org,
          sourceReference,
          sourceDigest,
          expectedLedgers: rows,
        })
      return bound ? run(bound) : tx(run)
    }
    await rollbackProbe(async (bound) => {
      await bound
        .update(tables.organizationMemberBillingLedger)
        .set({ totalCost: '-0.2' })
        .where(
          and(
            eq(tables.organizationMemberBillingLedger.organizationId, org),
            eq(tables.organizationMemberBillingLedger.userId, historical)
          )
        )
      const malformed = expectedLedgers.map((row: { userId: string }) =>
        row.userId === historical ? { ...row, totalCost: '-0.2' } : row
      )
      await expect(preserve(malformed, bound)).rejects.toThrow('money is invalid')
    })
    await rollbackProbe(async (bound) => {
      await bound
        .update(tables.organizationMemberBillingLedger)
        .set({ totalCopilotTokens: -9 })
        .where(
          and(
            eq(tables.organizationMemberBillingLedger.organizationId, org),
            eq(tables.organizationMemberBillingLedger.userId, historical)
          )
        )
      const malformed = expectedLedgers.map((row: { userId: string }) =>
        row.userId === historical ? { ...row, totalCopilotTokens: -9 } : row
      )
      await expect(preserve(malformed, bound)).rejects.toThrow('counter is invalid')
    })
    await rollbackProbe(async (bound) => {
      await bound
        .delete(tables.organizationBillingLedger)
        .where(eq(tables.organizationBillingLedger.organizationId, org))
      await expect(preserve(expectedLedgers, bound)).rejects.toThrow(
        'organization ledger is missing'
      )
    })
    await expect(
      preserve(expectedLedgers.filter((row: { userId: string }) => row.userId !== historical))
    ).rejects.toThrow('missing original')
    await expect(
      preserve(
        expectedLedgers.map((row: { userId: string; totalCost: string }) =>
          row.userId === historical ? { ...row, totalCost: '0' } : row
        )
      )
    ).rejects.toThrow('differ')
    await rollbackProbe(async (bound) => {
      await bound
        .delete(tables.organizationMemberBillingLedger)
        .where(
          and(
            eq(tables.organizationMemberBillingLedger.organizationId, org),
            eq(tables.organizationMemberBillingLedger.userId, historical)
          )
        )
      await expect(preserve(expectedLedgers, bound)).rejects.toThrow('missing original')
    })
    expect(await policy.readFinancialReceipt(db, ns(org), policy.memberRegistryKey)).toBeNull()
    expect(await preserve()).toMatchObject({ verifiedPairs: 2 })
    expect((await pair(org, historical))?.recordType).toBe('member-registration')
    const preservedPair = await pair(org, historical)
    expect(
      preservedPair?.recordType === 'member-registration' && preservedPair.provenance.kind
    ).toBe('verified-preservation')
    expect(await preserve()).toMatchObject({ verifiedPairs: 2 })
    await tx((bound) => policy.assertFinancialMemberTargets(bound, org))
    expect((await ledger(org, historical)).totalCost).toBe('0.2')
    expect((await ledger(org, historical)).totalCopilotTokens).toBe(9)
    void tier
  })

  it('holds creator authorization through the actual app transaction and rolls failed root creation back', async () => {
    const creator = await person('creator-race')
    const { createOrganizationWithFinancialRegistration } = await import('./financial-membership')
    const results = await Promise.allSettled(
      ['a', 'b'].map((label) =>
        createOrganizationWithFinancialRegistration({
          actorUserId: creator,
          name: 'Actual creator race',
          slug: `${stamp}-creator-${label}`,
        })
      )
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const memberships = await db
      .select()
      .from(tables.member)
      .where(eq(tables.member.userId, creator))
    expect(memberships).toHaveLength(1)
    await tx((bound) => policy.assertFinancialMemberTargets(bound, memberships[0].organizationId))
    const failed = randomUUID()
    await expect(
      tx((bound) =>
        policy.initializeFinancialMemberRegistry(bound, failed, async () => {
          await bound
            .insert(tables.organization)
            .values({ id: failed, name: 'Must roll back', slug: failed })
          throw new Error('Actual insertion failed')
        })
      )
    ).rejects.toThrow('Actual insertion failed')
    expect(
      await db.select().from(tables.organization).where(eq(tables.organization.id, failed))
    ).toHaveLength(0)
    expect(await policy.readFinancialReceipt(db, ns(failed), policy.memberRegistryKey)).toBeNull()
  })

  it('keeps actual organization POST authentication and input gates before creating registered targets', async () => {
    const { POST } = await import('@/app/api/organizations/route')
    state.session = null
    const request = (body: unknown) =>
      new Request('http://127.0.0.1/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await POST(request({ name: 'Denied', slug: 'denied' }))).status).toBe(401)
    const creator = await person('http-creator')
    state.session = { user: { id: creator, email: `${creator}@invalid.test` } }
    expect((await POST(request({ name: 'Invalid', slug: 'not valid!' }))).status).toBe(400)
    const created = await POST(
      request({ name: 'Genuine HTTP registration', slug: `${stamp}-http` })
    )
    expect(created.status).toBe(200)
    const body = await created.json()
    await tx((bound) => policy.assertFinancialMemberTargets(bound, body.organizationId))
    expect((await pair(body.organizationId, creator))?.recordType).toBe('member-registration')
    expect(
      (await POST(request({ name: 'Second denied', slug: `${stamp}-http-second` }))).status
    ).toBe(403)
  })

  it('serializes a real period rollover with a waiting first join and retains original member money', async () => {
    const f = await organizationFixture()
    const joiner = await person('rollover-waiter')
    await cost(f)
    const [sub] = await db
      .select()
      .from(tables.subscription)
      .where(eq(tables.subscription.referenceId, f.id))
    const original = {
      subscriptionId: sub.id,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      customerId: sub.stripeCustomerId,
      start: sub.periodStart!.toISOString(),
      end: sub.periodEnd!.toISOString(),
    }
    let announce!: () => void
    const locked = new Promise<void>((resolve) => {
      announce = resolve
    })
    let release!: () => void
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    const { updateFinancialSubscription } = await import('./financial-subscriptions')
    const rollover = db.transaction(async (bound) => {
      await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
      announce()
      await resume
      await updateFinancialSubscription(
        sub.id,
        {
          periodStart: new Date('2026-02-01T00:00:00Z'),
          periodEnd: new Date('2026-03-01T00:00:00Z'),
        },
        { transaction: bound }
      )
    })
    await locked
    const joining = adapter.create({
      model: 'member',
      data: { organizationId: f.id, userId: joiner, role: 'member', createdAt: new Date() },
    })
    release()
    await Promise.all([rollover, joining])
    const closing = await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(original))
    expect(closing?.recordType === 'period' && closing.closing?.memberUsd[f.owner]).toBe('0.3')
    expect((await ledger(f.id, f.owner)).lastPeriodCost).toBe('0.3')
    expect((await ledger(f.id, f.owner)).totalCost).toBe('0.3')
    expect((await ledger(f.id, joiner)).currentPeriodCost).toBe('0')
    await tx((bound) => policy.assertFinancialMemberTargets(bound, f.id))
  })

  it('refuses a waiting invocation after proven closed original-target deletion and preserves permanent registration', async () => {
    const f = await organizationFixture()
    const binding = await cost(f, f.owner, '0')
    const [sub] = await db
      .select()
      .from(tables.subscription)
      .where(eq(tables.subscription.referenceId, f.id))
    const period = {
      subscriptionId: sub.id,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      customerId: sub.stripeCustomerId,
      start: sub.periodStart!.toISOString(),
      end: sub.periodEnd!.toISOString(),
    }
    await tx(async (bound) => {
      await policy.closeFinancialPeriod(bound, { type: 'organization', id: f.id }, period)
      await bound
        .update(tables.subscription)
        .set({ status: 'canceled' })
        .where(eq(tables.subscription.id, sub.id))
    })
    for (const candidate of (await policy.listFinancialDispatch(db, Date.now())).filter(
      (row) => row.namespace === ns(f.id)
    )) {
      const claim = await tx((bound) => policy.claimFinancialDispatch(bound, candidate, Date.now()))
      expect(claim?.marker.kind).toBe('evaluate')
      await tx((bound) =>
        policy.evaluateFinancialPeriod(
          bound,
          candidate.namespace,
          candidate.key,
          claim!.marker.phase
        )
      )
      await tx((bound) =>
        policy.advanceFinancialDispatch(
          bound,
          claim!,
          (_receipt, head) => {
            head.state = 'complete'
          },
          Date.now()
        )
      )
    }
    let announce!: () => void
    const locked = new Promise<void>((resolve) => {
      announce = resolve
    })
    let release!: () => void
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    const registration = await pair(f.id, f.owner)
    const deleting = db.transaction(async (bound) => {
      await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
      await policy.assertFinancialRootClosed(bound, { type: 'organization', id: f.id })
      announce()
      await resume
      await bound.delete(tables.workspace).where(eq(tables.workspace.id, f.workspaceId))
      await bound.delete(tables.organization).where(eq(tables.organization.id, f.id))
    })
    await locked
    const waiting = tx((bound) =>
      policy.createInvocation(bound, {
        actorUserId: f.owner,
        workspaceId: f.workspaceId,
        runId: randomUUID(),
        operationKey: randomUUID(),
        purpose: 'copilot',
        schedulerReady: true,
      })
    )
    const refused = expect(waiting).rejects.toThrow()
    release()
    await deleting
    await refused
    expect(await ledger(f.id, f.owner)).toBeUndefined()
    expect(await pair(f.id, f.owner)).toEqual(registration)
    expect(
      await tx((bound) => policy.verifyAcceptance(bound, binding, { stepNumber: 0, retryCount: 0 }))
    ).toMatchObject({ accepted: true, appliedUsd: '0' })
    await tx((bound) =>
      policy.acceptModelStep(
        bound,
        binding,
        { stepNumber: 0, retryCount: 0 },
        { permittedProductUsd: '0' }
      )
    )
    expect(await ledger(f.id, f.owner)).toBeUndefined()
  })

  it('routes actual provider URL workflow scope to its real organization financial root before any model delegation', async () => {
    const f = await organizationFixture()
    const at = new Date()
    const workflowId = `${f.tag}-workflow`
    await db.insert(tables.workflow).values({
      id: workflowId,
      userId: f.owner,
      workspaceId: f.workspaceId,
      name: 'Disposable provider scope',
      lastSynced: at,
      createdAt: at,
      updatedAt: at,
    })
    const [personalBefore] = await db
      .select()
      .from(tables.userStats)
      .where(eq(tables.userStats.userId, f.owner))
    const [organizationBefore] = await db
      .select()
      .from(tables.organizationBillingLedger)
      .where(eq(tables.organizationBillingLedger.organizationId, f.id))
    let handlerCalls = 0
    let admissions = 0
    const bindings: policy.FinancialBinding[] = []
    state.providerActor = f.owner
    state.providerHandler = async ({ body, authUserId, requestId }) => {
      handlerCalls++
      if (!authUserId) throw new Error('Original authenticated provider actor required')
      const binding = await tx((bound) =>
        policy.createInvocation(bound, {
          actorUserId: authUserId,
          workspaceId: body.workspaceId,
          workflowId: body.workflowId,
          runId: requestId,
          operationKey: requestId,
          purpose: 'workflow-provider',
          schedulerReady: true,
        })
      )
      bindings.push(binding)
      await tx((bound) =>
        policy.admitModelStep(bound, binding, { stepNumber: 0, retryCount: 0 }, true)
      )
      admissions++
      await tx((bound) =>
        policy.acceptModelStep(
          bound,
          binding,
          { stepNumber: 0, retryCount: 0 },
          { usage: { totalTokens: 7 } }
        )
      )
      return NextResponse.json({
        financial: await tx((bound) =>
          policy.verifyAcceptance(bound, binding, { stepNumber: 0, retryCount: 0 })
        ),
      })
    }
    try {
      const { POST } = await import('@/app/api/providers/route')
      const request = (workflow: string, workspace: string, extra: object = {}) =>
        new NextRequest(
          `http://127.0.0.1/api/providers?workflowId=${encodeURIComponent(workflow)}&workspaceId=${encodeURIComponent(workspace)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              providerNamespace: 'ai',
              model: 'synthetic-no-model-call',
              messages: [],
              ...extra,
            }),
          }
        )
      const response = await POST(request(workflowId, f.workspaceId))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0' },
      })
      expect(bindings[0]).toMatchObject({
        namespace: ns(f.id),
        actorUserId: f.owner,
        workspaceId: f.workspaceId,
        workflowId,
        purpose: 'workflow-provider',
      })
      expect(
        await policy.readFinancialReceipt(db, bindings[0].namespace, bindings[0].key)
      ).toMatchObject({
        recordType: 'invocation',
        identity: {
          root: { type: 'organization', id: f.id },
          memberUserId: f.owner,
          workspaceId: f.workspaceId,
          workflowId,
          purpose: 'workflow-provider',
        },
      })
      expect(
        (
          await db
            .select()
            .from(tables.organizationBillingLedger)
            .where(eq(tables.organizationBillingLedger.organizationId, f.id))
        )[0].totalTokensUsed
      ).toBe(organizationBefore.totalTokensUsed + 7)
      expect(
        asJson(
          (await db.select().from(tables.userStats).where(eq(tables.userStats.userId, f.owner)))[0]
        )
      ).toEqual(asJson(personalBefore))
      expect(
        (await POST(request(workflowId, f.workspaceId, { workspaceId: 'conflicting-workspace' })))
          .status
      ).toBe(400)
      expect(handlerCalls).toBe(1)
      const foreign = await organizationFixture()
      const foreignId = `${foreign.tag}-foreign-workflow`
      await db.insert(tables.workflow).values({
        id: foreignId,
        userId: foreign.owner,
        workspaceId: foreign.workspaceId,
        name: 'Disposable unauthorized scope',
        lastSynced: at,
        createdAt: at,
        updatedAt: at,
      })
      expect((await POST(request(foreignId, foreign.workspaceId))).status).toBe(403)
      expect(handlerCalls).toBe(2)
      expect(admissions).toBe(1)
      expect(bindings).toHaveLength(1)
      expect(
        await db
          .select()
          .from(tables.idempotencyKey)
          .where(
            and(
              eq(tables.idempotencyKey.namespace, ns(foreign.id)),
              sql`${tables.idempotencyKey.result}->>'recordType' = 'invocation'`
            )
          )
      ).toHaveLength(0)
    } finally {
      state.providerActor = null
      state.providerHandler = null
    }
  })

  it('uses the actual dispatcher and installed Stripe transport to recover no-preparation crashes and lost acknowledgements without duplicate invoices or usage', async () => {
    const f = await invoiceFixture()
    const { dispatchFinancialMarkers } = await import('./dispatcher')
    const stripeRuntime = await import('@/lib/system-services/stripe-runtime')
    const config = vi
      .spyOn(stripeRuntime, 'getStripeServiceConfig')
      .mockReturnValue({ secretKey: 'sk_test_disposable_only', webhookSecret: null })
    const originalFetch = globalThis.fetch
    let clock = Date.now()
    const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const observed: { method: string; path: string; key: string | null }[] = []
    let remote: Record<string, any> | undefined
    let lost = false
    let preparations = 0
    const originalMethod = 'pm_disposable_original'
    let latestMethod = originalMethod
    const firstPreparation = new Map<string, number>()
    const read = async () => {
      const value = await policy.readFinancialReceipt(db, f.candidate.namespace, f.candidate.key)
      if (value?.recordType !== 'invoice') throw new Error('Actual invoice readback required')
      return value
    }
    const visitUntil = async (ready: (invoice: policy.InvoiceReceipt) => boolean) => {
      for (let visit = 0; visit < 8; visit++) {
        await dispatchFinancialMarkers()
        const current = await read()
        if (ready(current)) return current
      }
      throw new Error('Actual invoice phases did not complete their bounded fixture visits')
    }
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      expect(url.origin).toBe('https://api.stripe.com')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      const invoice = await read()
      const head = invoice.markers.find((marker) => marker.state === 'claimed')
      if (!head) throw new Error('Provider contact without a committed owning claim')
      expect(head).toMatchObject({
        provider: 'stripe',
        requestKey: `${f.intent.requestKey}:${head.phase}`,
        requestFingerprint: policy.financialFingerprint({
          intent: f.intent.fingerprint,
          phase: head.phase,
        }),
      })
      if (!firstPreparation.has(head.phase)) firstPreparation.set(head.phase, clock)
      expect(head.firstContactAtMs).toBe(firstPreparation.get(head.phase))
      preparations++
      const method = init?.method ?? 'GET'
      const headers = new Headers(init?.headers)
      observed.push({ method, path: url.pathname, key: headers.get('Idempotency-Key') })
      const body = new URLSearchParams(String(init?.body ?? ''))
      const reply = (value: unknown) =>
        Response.json(value, { headers: { 'request-id': 'req_disposable_invoice' } })
      if (method === 'GET' && url.pathname === `/v1/subscriptions/${f.period.stripeSubscriptionId}`)
        return reply({
          id: f.period.stripeSubscriptionId,
          customer: f.period.customerId,
          default_payment_method: latestMethod,
        })
      if (method === 'GET' && url.pathname === `/v1/customers/${f.period.customerId}`)
        return reply({
          id: f.period.customerId,
          object: 'customer',
          invoice_settings: { default_payment_method: 'pm_customer_different' },
        })
      if (
        method === 'GET' &&
        url.pathname === `/v1/customers/${f.period.customerId}/payment_methods/${originalMethod}`
      )
        return reply({
          id: originalMethod,
          object: 'payment_method',
          customer: f.period.customerId,
        })
      if (method === 'POST') {
        expect(head.payload).toMatchObject({
          version: 1,
          stage: 'request',
          paymentMethod: { id: originalMethod, source: 'subscription' },
        })
        expect(head.payload?.requestFingerprint).toBe(
          policy.financialFingerprint(head.payload?.request)
        )
      }
      if (method === 'POST' && url.pathname === '/v1/invoices') {
        expect(body.get('default_payment_method')).toBe(originalMethod)
        expect(remote).toBeUndefined()
        remote = {
          id: 'in_disposable',
          object: 'invoice',
          customer: f.period.customerId,
          currency: 'usd',
          status: 'draft',
          total: 0,
          amount_paid: 0,
          default_payment_method: body.get('default_payment_method'),
          metadata: Object.fromEntries(
            [...body.entries()]
              .filter(([key]) => key.startsWith('metadata['))
              .map(([key, value]) => [key.slice(9, -1), value])
          ),
        }
        if (!lost) {
          lost = true
          latestMethod = 'pm_subscription_changed_after_uncertain_create'
          throw new Error('Simulated lost invoice-create acknowledgement')
        }
        return reply(remote)
      }
      if (!remote) throw new Error('Read-only recovery cannot invent an invoice')
      if (method === 'GET' && url.pathname === '/v1/invoices')
        return reply({ object: 'list', data: [remote], has_more: false, url: '/v1/invoices' })
      if (method === 'GET' && url.pathname === '/v1/invoices/in_disposable') return reply(remote)
      if (method === 'POST' && url.pathname === '/v1/invoiceitems') {
        expect(body.get('amount')).toBe('10')
        return reply({
          id: 'ii_disposable',
          object: 'invoiceitem',
          customer: f.period.customerId,
          invoice: remote.id,
          amount: 10,
          currency: 'usd',
          metadata: remote.metadata,
        })
      }
      if (method === 'POST' && url.pathname === '/v1/invoices/in_disposable/finalize') {
        remote = { ...remote, status: 'open', total: 10 }
        return reply(remote)
      }
      if (method === 'POST' && url.pathname === '/v1/invoices/in_disposable/pay') {
        expect(body.get('payment_method')).toBe(originalMethod)
        remote = { ...remote, status: 'paid', amount_paid: 10 }
        return reply(remote)
      }
      throw new Error('Unexpected fake Stripe transport path')
    })
    try {
      const before = await ledger(f.id, f.owner)
      const first = await tx((bound) => policy.claimFinancialDispatch(bound, f.candidate, clock))
      if (!first) throw new Error('Actual unprepared invoice claim required')
      clock = first.marker.claimExpiresAtMs! + 1
      let invoice = await visitUntil((value) => value.markers[0].state === 'uncertain')
      expect(invoice.markers[0].state).toBe('uncertain')
      const firstContact = invoice.markers[0].firstContactAtMs
      expect(
        observed.filter((contact) => contact.method === 'POST' && contact.path === '/v1/invoices')
      ).toHaveLength(1)
      clock = invoice.markers[0].nextAtMs
      invoice = await visitUntil((value) => value.markers[0].phase === 'item')
      expect(invoice).toMatchObject({
        invoiceId: 'in_disposable',
        amountCents: '10',
        period: f.period,
      })
      expect(invoice.markers[0].phase).toBe('item')
      for (const field of [
        'payload',
        'provider',
        'firstContactAtMs',
        'requestKey',
        'requestFingerprint',
      ])
        expect(Object.hasOwn(invoice.markers[0], field)).toBe(false)
      const item = await tx((bound) => policy.claimFinancialDispatch(bound, f.candidate, clock))
      if (!item) throw new Error('Actual unprepared next invoice phase required')
      clock = item.marker.claimExpiresAtMs! + 1
      invoice = await visitUntil((value) => value.invoiceObligationState === 'closed')
      expect(invoice).toMatchObject({
        invoiceId: 'in_disposable',
        itemId: 'ii_disposable',
        issuance: 'issued',
        invoiceObligationState: 'closed',
      })
      expect(
        observed.filter((contact) => contact.method === 'POST').map((contact) => contact.path)
      ).toEqual([
        '/v1/invoices',
        '/v1/invoiceitems',
        '/v1/invoices/in_disposable/finalize',
        '/v1/invoices/in_disposable/pay',
      ])
      expect(
        observed.filter(
          (contact) => contact.path === `/v1/subscriptions/${f.period.stripeSubscriptionId}`
        )
      ).toHaveLength(1)
      expect(
        observed.filter((contact) => contact.path === `/v1/customers/${f.period.customerId}`)
      ).toHaveLength(1)
      expect(firstContact).toBeDefined()
      expect(preparations).toBe(observed.length)
      const after = await ledger(f.id, f.owner)
      expect(after).toMatchObject({
        totalCost: before.totalCost,
        currentPeriodCost: before.currentPeriodCost,
        totalTokensUsed: before.totalTokensUsed,
        totalCopilotCalls: before.totalCopilotCalls,
      })
      expect(
        await tx((bound) =>
          policy.verifyAcceptance(bound, f.binding, { stepNumber: 0, retryCount: 0 })
        )
      ).toMatchObject({ accepted: true, appliedUsd: '20.1' })
      const contactsBefore = observed.length
      await dispatchFinancialMarkers()
      expect(observed).toHaveLength(contactsBefore)
    } finally {
      globalThis.fetch = originalFetch
      clockSpy.mockRestore()
      config.mockRestore()
    }
  })

  it('reclaims only an unprepared invoice claim with new CAS IDs and never changes its accepted financial facts', async () => {
    const f = await invoiceFixture()
    const now = Date.now()
    const first = await tx((bound) => policy.claimFinancialDispatch(bound, f.candidate, now))
    if (!first) throw new Error('Actual first invoice claim required')
    const before = asJson(await ledger(f.id, f.owner))
    const second = await tx((bound) =>
      policy.claimFinancialDispatch(bound, f.candidate, first.marker.claimExpiresAtMs! + 1)
    )
    if (!second) throw new Error('Actual expired invoice reclaim required')
    expect(second.reconcile).toBe(false)
    expect(second.marker.claimId).not.toBe(first.marker.claimId)
    await expect(
      tx((bound) =>
        policy.prepareFinancialContact(
          bound,
          first,
          invoiceRequest(f.intent, 'create', first.marker.claimExpiresAtMs! + 1)
        )
      )
    ).rejects.toThrow('claim was lost')
    const contenders = await Promise.allSettled(
      [0, 1].map(() =>
        tx((bound) =>
          policy.claimFinancialDispatch(bound, f.candidate, second.marker.claimExpiresAtMs! + 1)
        )
      )
    )
    const winners = contenders.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    )
    expect(winners).toHaveLength(1)
    expect(winners[0].reconcile).toBe(false)
    expect(winners[0].marker.claimId).not.toBe(second.marker.claimId)
    expect(asJson(await ledger(f.id, f.owner))).toEqual(before)
    expect(
      await policy.readFinancialReceipt(db, f.candidate.namespace, f.candidate.key)
    ).toMatchObject({
      recordType: 'invoice',
      fingerprint: f.intent.fingerprint,
      amountCents: '10',
      requestKey: f.intent.requestKey,
      invoiceObligationState: 'open',
      issuance: 'pending',
    })
    expect(
      (await policy.readFinancialReceipt(db, f.candidate.namespace, policy.periodKey(f.period)))
        ?.recordType
    ).toBe('period')
  })

  it('keeps committed preparation uncertain before HTTP and refuses partial or malformed invoice evidence without repair', async () => {
    const f = await invoiceFixture()
    const now = Date.now()
    const original = await tx((bound) => policy.claimFinancialDispatch(bound, f.candidate, now))
    if (!original) throw new Error('Actual invoice claim required')
    const before = asJson(await ledger(f.id, f.owner))
    const base = await policy.readFinancialReceipt(db, f.candidate.namespace, f.candidate.key)
    if (base?.recordType !== 'invoice') throw new Error('Original invoice intent missing')
    const fragments: Record<string, unknown>[] = [
      { requestKey: 'partial' },
      { requestFingerprint: 'partial' },
      { provider: 'stripe' },
      { firstContactAtMs: now },
      { firstContactAtMs: null },
      { payload: {} },
      { providerId: 'partial' },
      { claimId: null },
      {
        requestKey: `${f.intent.requestKey}:create`,
        requestFingerprint: null,
        provider: 'stripe',
        firstContactAtMs: now,
      },
      {
        requestKey: `${f.intent.requestKey}:create`,
        requestFingerprint: 'mismatched',
        provider: 'resend',
        firstContactAtMs: now,
      },
      { state: 'uncertain', claimId: undefined, claimExpiresAtMs: undefined },
    ]
    for (const fragment of fragments)
      await rollbackProbe(async (bound) => {
        const corrupt = asJson(base)
        Object.assign(corrupt.markers[0], fragment)
        await bound
          .update(tables.idempotencyKey)
          .set({ result: asJson(corrupt) })
          .where(
            and(
              eq(tables.idempotencyKey.namespace, f.candidate.namespace),
              eq(tables.idempotencyKey.key, f.candidate.key)
            )
          )
        await expect(
          policy.claimFinancialDispatch(bound, f.candidate, original.marker.claimExpiresAtMs! + 1)
        ).rejects.toThrow('classification')
        if (fragment.state !== 'uncertain' && fragment.claimId !== null)
          await expect(
            policy.prepareFinancialContact(bound, original, invoiceRequest(f.intent, 'create', now))
          ).rejects.toThrow('classification')
      })
    await tx((bound) =>
      policy.prepareFinancialContact(bound, original, invoiceRequest(f.intent, 'create', now))
    )
    const persisted = await policy.readFinancialReceipt(db, f.candidate.namespace, f.candidate.key)
    const recovered = await tx((bound) =>
      policy.claimFinancialDispatch(bound, f.candidate, original.marker.claimExpiresAtMs! + 1)
    )
    if (!recovered || persisted?.recordType !== 'invoice')
      throw new Error('Committed invoice preparation recovery required')
    expect(recovered.reconcile).toBe(true)
    expect(recovered.marker.firstContactAtMs).toBe(now)
    expect(recovered.marker.requestKey).toBe(persisted.markers[0].requestKey)
    expect(recovered.marker.requestFingerprint).toBe(persisted.markers[0].requestFingerprint)
    await tx((bound) =>
      policy.prepareFinancialContact(
        bound,
        recovered,
        invoiceRequest(f.intent, 'create', original.marker.claimExpiresAtMs! + 1)
      )
    )
    expect(recovered.marker.firstContactAtMs).toBe(now)
    expect(asJson(await ledger(f.id, f.owner))).toEqual(before)
  })

  async function scopeFixture(scope: 'pooled' | 'individual') {
    const f = await organizationFixture(1, scope)
    const [originalTier] = await db
      .update(tables.systemBillingTier)
      .set({ includedUsageLimitUsd: '40' })
      .where(eq(tables.systemBillingTier.id, `${f.tag}-tier`))
      .returning()
    const requestedTierId = `${f.tag}-opposite-scope`
    await db.insert(tables.systemBillingTier).values({
      ...originalTier,
      id: requestedTierId,
      usageScope: scope === 'pooled' ? 'individual' : 'pooled',
    })
    const [originalSubscription] = await db
      .select()
      .from(tables.subscription)
      .where(
        and(
          eq(tables.subscription.referenceType, 'organization'),
          eq(tables.subscription.referenceId, f.id)
        )
      )
    if (!originalSubscription || originalSubscription.plan !== originalTier.id)
      throw new Error('Actual original scope subscription binding required')
    return { ...f, subId: originalSubscription.id, originalTier, requestedTierId }
  }
  async function scopeBinding(f: Awaited<ReturnType<typeof scopeFixture>>) {
    return tx((bound) =>
      policy.createInvocation(bound, {
        actorUserId: f.owner,
        workspaceId: f.workspaceId,
        runId: randomUUID(),
        operationKey: randomUUID(),
        purpose: 'copilot',
        quotedHoldUsd: '0.1',
        schedulerReady: true,
      })
    )
  }
  const firstScopeOccurrence = { stepNumber: 0, retryCount: 0 }
  const lateScopeOccurrence = { stepNumber: 1, retryCount: 0 }
  const acceptScopeAmount = (
    binding: policy.FinancialBinding,
    occurrence: policy.ModelOccurrence,
    amount: string
  ) =>
    tx((bound) =>
      policy.acceptModelStep(bound, binding, occurrence, {
        permittedProductUsd: amount,
        usage: { totalTokens: 7 },
      })
    )
  async function scopePeriod(binding: policy.FinancialBinding) {
    const invocation = await policy.readFinancialReceipt(db, binding.namespace, binding.key)
    if (invocation?.recordType !== 'invocation' || !invocation.identity.period)
      throw new Error('Original scope test invocation period required')
    return invocation.identity.period
  }
  async function scopeSnapshot(
    f: Pick<Awaited<ReturnType<typeof scopeFixture>>, 'id' | 'owner' | 'subId'>,
    binding?: policy.FinancialBinding
  ) {
    const [sub] = await db
      .select()
      .from(tables.subscription)
      .where(eq(tables.subscription.id, f.subId))
    const [organizationLedger] = await db
      .select()
      .from(tables.organizationBillingLedger)
      .where(eq(tables.organizationBillingLedger.organizationId, f.id))
    const head = await policy.readFinancialReceipt(db, ns(f.id), 'period-head')
    const operation = (occurrence: policy.ModelOccurrence) =>
      binding
        ? policy.readFinancialReceipt(
            db,
            binding.namespace,
            policy.occurrenceKey(binding, occurrence)
          )
        : null
    return asJson({
      sub,
      organizationLedger,
      memberLedger: await ledger(f.id, f.owner),
      head,
      invocation: binding
        ? await policy.readFinancialReceipt(db, binding.namespace, binding.key)
        : null,
      first: await operation(firstScopeOccurrence),
      late: await operation(lateScopeOccurrence),
    })
  }
  async function mutateScopeSubscription(
    writer: 'adapter' | 'direct',
    f: Awaited<ReturnType<typeof scopeFixture>>,
    patch: Partial<typeof tables.subscription.$inferInsert>
  ) {
    if (writer === 'adapter')
      return adapter.update({
        model: 'subscription',
        where: [{ field: 'id', value: f.subId }],
        update: patch,
      })
    const { updateFinancialSubscription } = await import('./financial-subscriptions')
    return updateFinancialSubscription(f.subId, patch)
  }
  for (const writer of ['adapter', 'direct'] as const) {
    for (const scope of ['pooled', 'individual'] as const) {
      it(`refuses ${writer} same-period ${scope} conversion with unused, uncertain and accepted obligations`, async () => {
        const f = await scopeFixture(scope)
        const refuse = async (binding?: policy.FinancialBinding) => {
          const before = await scopeSnapshot(f, binding)
          await expect(
            mutateScopeSubscription(writer, f, { plan: f.requestedTierId })
          ).rejects.toMatchObject({
            status: 409,
            message: 'Same-period organization monetary scope cannot change',
          })
          expect(await scopeSnapshot(f, binding)).toEqual(before)
        }
        expect((await scopeSnapshot(f)).head).toBeNull()
        await refuse()
        const binding = await scopeBinding(f)
        const period = await scopePeriod(binding)
        for (const occurrence of [firstScopeOccurrence, lateScopeOccurrence])
          await tx((bound) => policy.admitModelStep(bound, binding, occurrence, true))
        expect((await scopeSnapshot(f, binding)).late).toMatchObject({
          contactState: 'uncertain',
          holdState: 'outstanding',
        })
        await refuse(binding)
        await acceptScopeAmount(binding, firstScopeOccurrence, '60')
        await refuse(binding)
        const [settings] = await db
          .select()
          .from(tables.systemBillingSettings)
          .where(eq(tables.systemBillingSettings.id, 'global'))
        expect(settings.overageThresholdDollars).toBe('50')
        expect(
          await tx((bound) =>
            policy.evaluateFinancialPeriod(
              bound,
              binding.namespace,
              policy.periodKey(period),
              'threshold'
            )
          )
        ).toBeNull()
        await tx((bound) =>
          policy.closeFinancialPeriod(bound, { type: 'organization', id: f.id }, period)
        )
        const basis = await policy.readFinancialReceipt(
          db,
          binding.namespace,
          policy.periodKey(period)
        )
        expect(basis?.recordType === 'period' && basis.closing).toMatchObject({
          mode: scope,
          acceptedUsd: '60',
          allowanceUsd: '40',
          memberUsd: scope === 'individual' ? { [f.owner]: '60' } : {},
        })
        expect(
          await tx((bound) =>
            policy.evaluateFinancialPeriod(
              bound,
              binding.namespace,
              policy.periodKey(period),
              'final'
            )
          )
        ).toMatchObject({ recordType: 'invoice', amountCents: '2000', subtype: 'final' })
        await acceptScopeAmount(binding, lateScopeOccurrence, '0.3')
        const accepted = await scopeSnapshot(f, binding)
        await acceptScopeAmount(binding, lateScopeOccurrence, '0.3')
        expect(await scopeSnapshot(f, binding)).toEqual(accepted)
        expect(
          await tx((bound) => policy.verifyAcceptance(bound, binding, lateScopeOccurrence))
        ).toMatchObject({ accepted: true, appliedUsd: '0.3' })
      })

      it(`preserves ${writer} ${scope} frozen liability and late idempotence across a genuine opposite-scope rollover`, async () => {
        const f = await scopeFixture(scope)
        const binding = await scopeBinding(f)
        await tx((bound) => policy.admitModelStep(bound, binding, firstScopeOccurrence, true))
        const accepted = await cost(f, f.owner, '60')
        const original = await scopePeriod(binding)
        await mutateScopeSubscription(writer, f, {
          plan: f.requestedTierId,
          periodStart: new Date('2026-02-01T00:00:00Z'),
          periodEnd: new Date('2026-03-01T00:00:00Z'),
        })
        const frozen = await policy.readFinancialReceipt(
          db,
          binding.namespace,
          policy.periodKey(original)
        )
        expect(frozen?.recordType === 'period' && frozen.closing).toMatchObject({
          mode: scope,
          allowanceUsd: '40',
          acceptedUsd: '60',
          memberUsd: scope === 'individual' ? { [f.owner]: '60' } : {},
        })
        expect((await scopeSnapshot(f, binding)).organizationLedger).toMatchObject({
          currentPeriodCost: '0',
          lastPeriodCost: '60',
          totalCost: '60',
        })
        await acceptScopeAmount(binding, firstScopeOccurrence, '0.3')
        const late = await scopeSnapshot(f, binding)
        expect(late.organizationLedger).toMatchObject({
          currentPeriodCost: '0',
          lastPeriodCost: '60.3',
          totalCost: '60.3',
        })
        await acceptScopeAmount(binding, firstScopeOccurrence, '0.3')
        expect(await scopeSnapshot(f, binding)).toEqual(late)
        expect(
          await tx((bound) => policy.verifyAcceptance(bound, accepted, firstScopeOccurrence))
        ).toMatchObject({ accepted: true, appliedUsd: '60' })
        const current = await cost(f, f.owner, '0.2')
        const currentInvocation = await policy.readFinancialReceipt(
          db,
          current.namespace,
          current.key
        )
        expect(
          currentInvocation?.recordType === 'invocation' && currentInvocation.identity
        ).toMatchObject({
          memberUserId: scope === 'pooled' ? f.owner : null,
          period: {
            start: '2026-02-01T00:00:00.000Z',
            end: '2026-03-01T00:00:00.000Z',
          },
        })
        expect((await scopeSnapshot(f)).organizationLedger).toMatchObject({
          currentPeriodCost: '0.2',
          lastPeriodCost: '60.3',
          totalCost: '60.5',
        })
        expect(
          await tx((bound) =>
            policy.evaluateFinancialPeriod(
              bound,
              binding.namespace,
              policy.periodKey(original),
              'final'
            )
          )
        ).toMatchObject({ recordType: 'invoice', amountCents: '2030', subtype: 'final' })
      })
    }
    it(`allows ${writer} same-scope live allowance and seat edits without rotating or rewriting accepted money`, async () => {
      const f = await scopeFixture('pooled')
      const binding = await cost(f)
      const sameScopeTier = `${f.tag}-same-scope`
      await db.insert(tables.systemBillingTier).values({
        ...f.originalTier,
        id: sameScopeTier,
        seatCount: 2,
        includedUsageLimitUsd: '45',
      })
      const before = await scopeSnapshot(f, binding)
      await mutateScopeSubscription(writer, f, { plan: sameScopeTier, seats: 2 })
      const after = await scopeSnapshot(f, binding)
      expect(after.sub).toMatchObject({
        plan: sameScopeTier,
        billingTierId: sameScopeTier,
        seats: 2,
      })
      expect(after.organizationLedger).toEqual(before.organizationLedger)
      expect(after.memberLedger).toEqual(before.memberLedger)
      expect(after.head).toEqual(before.head)
      expect(after.invocation).toEqual(before.invocation)
      expect(after.first).toEqual(before.first)
      const period = await scopePeriod(binding)
      expect(
        await policy.readFinancialReceipt(db, binding.namespace, policy.periodKey(period))
      ).toMatchObject({ recordType: 'period', financialClosureState: 'open' })
      expect(
        await tx((bound) => policy.verifyAcceptance(bound, binding, firstScopeOccurrence))
      ).toMatchObject({ accepted: true, appliedUsd: '0.3' })
    })

    for (const first of ['acceptance', 'conversion'] as const) {
      it(`serializes ${writer} rejected scope conversion with ${first} queued first and preserves the accepted original posting`, async () => {
        const f = await scopeFixture('pooled')
        const binding = await scopeBinding(f)
        await tx((bound) => policy.admitModelStep(bound, binding, firstScopeOccurrence, true))
        let announce!: (pid: number) => void
        let release!: () => void
        const locked = new Promise<number>((resolve) => {
          announce = resolve
        })
        const resume = new Promise<void>((resolve) => {
          release = resolve
        })
        const holder = db.transaction(async (bound) => {
          await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
          const [session] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
          if (typeof session.pid !== 'number') throw new Error('Owned root session is missing')
          announce(session.pid)
          await resume
        })
        const blocker = await locked
        const accepting = () => acceptScopeAmount(binding, firstScopeOccurrence, '0.3')
        const converting = () => mutateScopeSubscription(writer, f, { plan: f.requestedTierId })
        const firstResult = Promise.allSettled([
          first === 'acceptance' ? accepting() : converting(),
        ])
        let secondResult: Promise<PromiseSettledResult<unknown>[]> | undefined
        try {
          const firstPid = await waitForBlockedSession(blocker)
          secondResult = Promise.allSettled([first === 'acceptance' ? converting() : accepting()])
          await waitForBlockedSession(firstPid)
        } finally {
          release()
          const results = await Promise.allSettled([
            holder,
            firstResult,
            ...(secondResult ? [secondResult] : []),
          ])
          expect(results[0].status).toBe('fulfilled')
        }
        if (!secondResult) throw new Error('Actual second queued mutation was not started')
        const [a] = await firstResult
        const [b] = await secondResult
        const conversion = first === 'conversion' ? a : b
        const acceptance = first === 'acceptance' ? a : b
        expect(conversion.status).toBe('rejected')
        if (conversion.status !== 'rejected') throw new Error('Unsupported conversion committed')
        expect(conversion.reason).toMatchObject({
          status: 409,
          message: 'Same-period organization monetary scope cannot change',
        })
        expect(acceptance.status).toBe('fulfilled')
        const after = await scopeSnapshot(f, binding)
        expect(after.sub).toMatchObject({
          plan: f.originalTier.id,
          billingTierId: f.originalTier.id,
        })
        expect(after.organizationLedger).toMatchObject({
          currentPeriodCost: '0.3',
          totalCost: '0.3',
        })
        expect(after.first).toMatchObject({
          contactState: 'accepted',
          holdState: 'closed',
          appliedUsd: '0.3',
        })
        expect(
          await tx((bound) => policy.verifyAcceptance(bound, binding, firstScopeOccurrence))
        ).toMatchObject({ accepted: true, appliedUsd: '0.3' })
      })
    }
  }

  async function baseInvoiceFixture() {
    const f = await scopeFixture('individual')
    const [original] = await db
      .select()
      .from(tables.subscription)
      .where(eq(tables.subscription.id, f.subId))
    const period: policy.Period = {
      subscriptionId: original.id,
      stripeSubscriptionId: original.stripeSubscriptionId,
      customerId: original.stripeCustomerId,
      start: original.periodStart!.toISOString(),
      end: original.periodEnd!.toISOString(),
    }
    return { ...f, period }
  }
  function baseInvoiceLine(
    f: Awaited<ReturnType<typeof baseInvoiceFixture>>,
    proration = false,
    kind: 'subscription_item_details' | 'invoice_item_details' = 'subscription_item_details',
    interval = { start: Date.parse(f.period.start!) / 1000, end: Date.parse(f.period.end!) / 1000 },
    creditedInvoice?: string
  ) {
    return {
      id: randomUUID(),
      object: 'line_item',
      amount: proration ? -500 : 4000,
      period: interval,
      parent: {
        type: kind,
        [kind]: {
          subscription: f.period.stripeSubscriptionId,
          subscription_item: `${f.tag}-item`,
          invoice_item: `${f.tag}-invoice-item`,
          proration,
          proration_details: creditedInvoice
            ? {
                credited_items: {
                  invoice: creditedInvoice,
                  invoice_line_items: ['credited-source-line'],
                },
              }
            : null,
        },
      },
    }
  }
  function baseProrations(
    f: Awaited<ReturnType<typeof baseInvoiceFixture>>,
    kind: 'subscription_item_details' | 'invoice_item_details' = 'subscription_item_details',
    interval?: { start: number; end: number },
    creditedInvoice?: string,
    debit = 4000
  ) {
    return [
      { ...baseInvoiceLine(f, true, kind, interval), amount: debit },
      baseInvoiceLine(f, true, kind, interval, creditedInvoice),
    ]
  }
  function baseInvoice(
    f: Awaited<ReturnType<typeof baseInvoiceFixture>>,
    lines: unknown[],
    overrides: Record<string, unknown> = {}
  ) {
    return {
      id: `in_${randomUUID()}`,
      object: 'invoice',
      status: 'open',
      customer: f.period.customerId,
      currency: 'usd',
      total: 3500,
      amount_paid: 0,
      attempt_count: 1,
      metadata: {},
      period_start: 0,
      period_end: 1,
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: f.period.stripeSubscriptionId },
      },
      lines: { object: 'list', data: lines, has_more: false },
      ...overrides,
    }
  }
  function signedBaseInvoice(invoice: Record<string, unknown>, type: string) {
    const signer = new Stripe('sk_test_synthetic_signature_only')
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: 'event',
      api_version: '2025-08-27.basil',
      type,
      data: { object: invoice },
    })
    const secret = 'whsec_synthetic_source_only'
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret })
    return signer.webhooks.constructEvent(payload, signature, secret)
  }
  async function baseInvoiceMoney(
    f: Awaited<ReturnType<typeof baseInvoiceFixture>>,
    binding?: policy.FinancialBinding
  ) {
    const snapshot = await scopeSnapshot(f, binding)
    const { billingBlocked: _blocked, updatedAt: _updated, ...money } = snapshot.organizationLedger
    return { ...snapshot, organizationLedger: money }
  }
  async function baseInvoiceEvents(invoice: Record<string, unknown>) {
    const handlers = await import('./webhooks/invoices')
    return {
      finalized: () =>
        handlers.handleInvoiceFinalized(signedBaseInvoice(invoice, 'invoice.finalized')),
      failed: () =>
        handlers.handleInvoicePaymentFailed(signedBaseInvoice(invoice, 'invoice.payment_failed')),
      paid: () =>
        handlers.handleInvoicePaymentSucceeded(
          signedBaseInvoice(
            { ...invoice, status: 'paid', amount_paid: invoice.total },
            'invoice.payment_succeeded'
          )
        ),
    }
  }
  async function blockedBaseRoot(f: Awaited<ReturnType<typeof baseInvoiceFixture>>) {
    return (
      await db
        .select({ blocked: tables.organizationBillingLedger.billingBlocked })
        .from(tables.organizationBillingLedger)
        .where(eq(tables.organizationBillingLedger.organizationId, f.id))
    )[0].blocked
  }
  it('registers a signed mixed renewal and carried proration without losing full base debt or touching usage', async () => {
    const f = await baseInvoiceFixture()
    const invoice = baseInvoice(f, [
      baseInvoiceLine(f),
      baseInvoiceLine(f, true, 'invoice_item_details', {
        start: Date.parse('2025-12-15T00:00:00Z') / 1000,
        end: Date.parse(f.period.start!) / 1000,
      }),
    ])
    const events = await baseInvoiceEvents(invoice)
    await events.finalized()
    const original = await policy.readSubscriptionInvoice(db, invoice.id as string)
    expect(original?.intent).toMatchObject({
      subtype: 'subscription',
      period: f.period,
      amountCents: '3500',
      issuance: 'issued',
      invoiceObligationState: 'open',
    })
    const money = await baseInvoiceMoney(f)
    await events.failed()
    await events.failed()
    const failed = await policy.readSubscriptionInvoice(db, invoice.id as string)
    expect(failed?.intent.markers.filter((marker) => marker.kind === 'notification')).toHaveLength(
      1
    )
    expect(await blockedBaseRoot(f)).toBe(true)
    expect(await baseInvoiceMoney(f)).toEqual(money)
    await events.paid()
    await events.failed()
    await events.finalized()
    expect((await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent).toMatchObject({
      fingerprint: original!.intent.fingerprint,
      amountCents: '3500',
      period: f.period,
      invoiceObligationState: 'closed',
    })
    expect(await blockedBaseRoot(f)).toBe(false)
    expect(await baseInvoiceMoney(f)).toEqual(money)
  })
  for (const parent of ['subscription_item_details', 'invoice_item_details'] as const) {
    it(`registers a fresh original complete period for signed ${parent} proration-only events`, async () => {
      const f = await baseInvoiceFixture()
      expect(await policy.readFinancialReceipt(db, ns(f.id), 'period-head')).toBeNull()
      const invoice = baseInvoice(
        f,
        baseProrations(f, parent, {
          start: Date.parse('2026-01-15T00:00:00Z') / 1000,
          end: Date.parse(f.period.end!) / 1000,
        })
      )
      const events = await baseInvoiceEvents(invoice)
      await events.finalized()
      expect(
        (await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent
      ).toMatchObject({ period: f.period, amountCents: '3500', invoiceObligationState: 'open' })
      const money = await baseInvoiceMoney(f)
      await events.failed()
      await events.paid()
      expect(
        (await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent
          .invoiceObligationState
      ).toBe('closed')
      expect(await baseInvoiceMoney(f)).toEqual(money)
      expect(money.organizationLedger).toMatchObject({
        totalCost: '0',
        currentPeriodCost: '0',
        lastPeriodCost: '0',
      })
    })
  }
  it('keeps two original base debts and uncertain holds distinct through signed failures, payments and duplicates', async () => {
    const f = await baseInvoiceFixture()
    await cost(f)
    const binding = await scopeBinding(f)
    await tx((bound) => policy.admitModelStep(bound, binding, firstScopeOccurrence, true))
    const money = await baseInvoiceMoney(f, binding)
    const first = baseInvoice(f, baseProrations(f))
    const second = baseInvoice(
      f,
      baseProrations(f, 'subscription_item_details', undefined, undefined, 1734),
      { total: 1234 }
    )
    const a = await baseInvoiceEvents(first)
    const b = await baseInvoiceEvents(second)
    await a.failed()
    await b.failed()
    await a.paid()
    await a.paid()
    expect(await blockedBaseRoot(f)).toBe(true)
    expect(
      (await policy.readSubscriptionInvoice(db, first.id as string))?.intent.invoiceObligationState
    ).toBe('closed')
    expect(
      (await policy.readSubscriptionInvoice(db, second.id as string))?.intent.invoiceObligationState
    ).toBe('open')
    expect(await baseInvoiceMoney(f, binding)).toEqual(money)
    await b.paid()
    await a.failed()
    expect(await blockedBaseRoot(f)).toBe(false)
    expect(await baseInvoiceMoney(f, binding)).toEqual(money)
    expect(money.first).toMatchObject({ contactState: 'uncertain', holdState: 'outstanding' })
  })
  it('resolves delayed proration-only base debt against the original previous closing basis without changing either usage slot', async () => {
    const f = await baseInvoiceFixture()
    await cost(f)
    const binding = await scopeBinding(f)
    await tx((bound) => policy.admitModelStep(bound, binding, firstScopeOccurrence, true))
    const { updateFinancialSubscription } = await import('./financial-subscriptions')
    await updateFinancialSubscription(f.subId, {
      periodStart: new Date('2026-02-01T00:00:00Z'),
      periodEnd: new Date('2026-03-01T00:00:00Z'),
    })
    await cost(f, f.owner, '0.2')
    const money = await baseInvoiceMoney(f, binding)
    const invoice = baseInvoice(f, baseProrations(f))
    const events = await baseInvoiceEvents(invoice)
    await events.finalized()
    expect((await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent.period).toEqual(
      f.period
    )
    await events.failed()
    await events.paid()
    expect(await baseInvoiceMoney(f, binding)).toEqual(money)
    expect(money.organizationLedger).toMatchObject({
      totalCost: '0.5',
      currentPeriodCost: '0.2',
      lastPeriodCost: '0.3',
    })
  })
  it('retains canceled original invoice ownership through a distinct paid replacement subscription', async () => {
    const f = await baseInvoiceFixture()
    await cost(f)
    await adapter.update({
      model: 'subscription',
      where: [{ field: 'id', value: f.subId }],
      update: { status: 'canceled', periodEnd: new Date('2026-01-20T00:00:00Z') },
    })
    const { createFinancialSubscription } = await import('./financial-subscriptions')
    await createFinancialSubscription({
      id: randomUUID(),
      plan: f.originalTier.id,
      billingTierId: f.originalTier.id,
      referenceType: 'organization',
      referenceId: f.id,
      stripeCustomerId: `${f.tag}-replacement-customer`,
      stripeSubscriptionId: `${f.tag}-replacement-subscription`,
      status: 'active',
      seats: 1,
      periodStart: new Date('2026-02-01T00:00:00Z'),
      periodEnd: new Date('2026-03-01T00:00:00Z'),
    })
    const invoice = baseInvoice(f, baseProrations(f))
    const events = await baseInvoiceEvents(invoice)
    await events.finalized()
    const bound = await policy.readSubscriptionInvoice(db, invoice.id as string)
    expect(bound?.intent).toMatchObject({
      root: { type: 'organization', id: f.id },
      period: f.period,
    })
    const money = await baseInvoiceMoney(f)
    await events.failed()
    await events.paid()
    expect(await baseInvoiceMoney(f)).toEqual(money)
    expect((await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent.period).toEqual(
      f.period
    )
  })
  it('uses positive credited-original invoice evidence for an older closing basis after two rollovers', async () => {
    const f = await baseInvoiceFixture()
    await cost(f)
    const originalInvoice = baseInvoice(f, [baseInvoiceLine(f)], { total: 4000 })
    const originalEvents = await baseInvoiceEvents(originalInvoice)
    await originalEvents.finalized()
    await originalEvents.paid()
    const { updateFinancialSubscription } = await import('./financial-subscriptions')
    for (const [start, end] of [
      ['2026-02-01', '2026-03-01'],
      ['2026-03-01', '2026-04-01'],
    ])
      await updateFinancialSubscription(f.subId, {
        periodStart: new Date(`${start}T00:00:00Z`),
        periodEnd: new Date(`${end}T00:00:00Z`),
      })
    const money = await baseInvoiceMoney(f)
    const interval = {
      start: Date.parse('2026-01-15T00:00:00Z') / 1000,
      end: Date.parse(f.period.end!) / 1000,
    }
    const missing = baseInvoice(f, baseProrations(f, 'invoice_item_details', interval))
    await expect((await baseInvoiceEvents(missing)).finalized()).rejects.toThrow(
      'missing or ambiguous'
    )
    expect(await policy.readSubscriptionInvoice(db, missing.id as string)).toBeNull()
    const credited = baseInvoice(
      f,
      baseProrations(f, 'invoice_item_details', interval, originalInvoice.id as string, 1000),
      { total: 500 }
    )
    const events = await baseInvoiceEvents(credited)
    await events.finalized()
    expect((await policy.readSubscriptionInvoice(db, credited.id as string))?.intent).toMatchObject(
      { period: f.period, amountCents: '500' }
    )
    await events.failed()
    await events.paid()
    expect(await baseInvoiceMoney(f)).toEqual(money)
  })
  it('rejects malformed or changed signed base invoice evidence without writes and refuses unknown money without seeding a head', async () => {
    const f = await baseInvoiceFixture()
    const binding = await cost(f)
    const money = await baseInvoiceMoney(f, binding)
    const good = baseInvoice(f, baseProrations(f))
    const events = await baseInvoiceEvents(good)
    await events.finalized()
    for (const override of [
      { total: 3501 },
      { currency: 'eur' },
      { customer: 'wrong-original-customer' },
      {
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: 'wrong-original-subscription' },
        },
      },
      { lines: { data: [baseInvoiceLine(f, true)], has_more: true } },
      { lines: { data: [], has_more: false } },
      {
        lines: {
          data: [
            baseInvoiceLine(f),
            baseInvoiceLine(f, false, 'subscription_item_details', {
              start: Date.parse('2026-02-01T00:00:00Z') / 1000,
              end: Date.parse('2026-03-01T00:00:00Z') / 1000,
            }),
          ],
          has_more: false,
        },
      },
      {
        lines: {
          data: [{ ...baseInvoiceLine(f), subscription: 'conflicting-subscription' }],
          has_more: false,
        },
      },
      { total: -1 },
    ]) {
      const value = { ...good, ...override }
      await expect((await baseInvoiceEvents(value)).paid()).rejects.toThrow()
      expect(await baseInvoiceMoney(f, binding)).toEqual(money)
    }
    expect(
      (await policy.readSubscriptionInvoice(db, good.id as string))?.intent.invoiceObligationState
    ).toBe('open')
    const unknown = await baseInvoiceFixture()
    await db
      .update(tables.organizationBillingLedger)
      .set({ totalCost: '0.3', currentPeriodCost: '0.3' })
      .where(eq(tables.organizationBillingLedger.organizationId, unknown.id))
    const unproven = baseInvoice(unknown, baseProrations(unknown))
    await expect((await baseInvoiceEvents(unproven)).finalized()).rejects.toThrow('preservation')
    expect(await policy.readSubscriptionInvoice(db, unproven.id as string)).toBeNull()
    expect(await policy.readFinancialReceipt(db, ns(unknown.id), 'period-head')).toBeNull()
    // This dedicated forced-unknown fixture remains unmodified until whole owned test-DB teardown.
  })
  it('rolls canonical base registration, failure marker and blocked state back together without resetting usage', async () => {
    const f = await baseInvoiceFixture()
    const invoiceId = `in_${randomUUID()}`
    const before = await baseInvoiceMoney(f)
    await rollbackProbe(async (bound) => {
      const registered = await policy.registerSubscriptionInvoice(bound, {
        root: { type: 'organization', id: f.id },
        period: f.period,
        invoiceId,
        amountCents: '3500',
        currency: 'usd',
      })
      await policy.acceptInvoicePayment(bound, {
        namespace: registered.namespace,
        key: registered.key,
        invoiceId,
        customerId: f.period.customerId!,
        amountCents: '3500',
        currency: 'usd',
        fingerprint: registered.intent.fingerprint,
        period: f.period,
        paid: false,
      })
      expect(
        (await policy.readFinancialReceipt(bound, registered.namespace, registered.key))?.recordType
      ).toBe('invoice')
    })
    expect(await policy.readSubscriptionInvoice(db, invoiceId)).toBeNull()
    expect(await baseInvoiceMoney(f)).toEqual(before)
    expect(await blockedBaseRoot(f)).toBe(false)
  })
  for (const first of ['failure', 'payment'] as const) {
    it(`serializes real signed base handlers with ${first} queued first, preserving one closed original obligation`, async () => {
      const f = await baseInvoiceFixture()
      const binding = await cost(f)
      const before = await baseInvoiceMoney(f, binding)
      const invoice = baseInvoice(f, baseProrations(f))
      const events = await baseInvoiceEvents(invoice)
      let announce!: (pid: number) => void
      let release!: () => void
      const locked = new Promise<number>((resolve) => {
        announce = resolve
      })
      const resume = new Promise<void>((resolve) => {
        release = resolve
      })
      const holder = db.transaction(async (bound) => {
        await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
        const [session] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
        if (typeof session.pid !== 'number')
          throw new Error('Owned base-invoice root session missing')
        announce(session.pid)
        await resume
      })
      const blocker = await locked
      const earlier = Promise.allSettled([first === 'failure' ? events.failed() : events.paid()])
      let later: Promise<PromiseSettledResult<unknown>[]> | undefined
      try {
        const firstPid = await waitForBlockedSession(blocker)
        later = Promise.allSettled([first === 'failure' ? events.paid() : events.failed()])
        await waitForBlockedSession(firstPid)
      } finally {
        release()
        await Promise.allSettled([holder, earlier, ...(later ? [later] : [])])
      }
      if (!later) throw new Error('Second actual signed invoice handler was not started')
      expect((await earlier)[0].status).toBe('fulfilled')
      expect((await later)[0].status).toBe('fulfilled')
      expect(
        (await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent
      ).toMatchObject({ invoiceObligationState: 'closed', period: f.period, amountCents: '3500' })
      expect(await blockedBaseRoot(f)).toBe(false)
      expect(await baseInvoiceMoney(f, binding)).toEqual(before)
    })
  }

  // R6 uses the same real app adapter, current direct helpers and installed canonical policy.
  for (const writer of ['adapter', 'direct'] as const) {
    for (const scope of ['pooled', 'individual'] as const) {
      it(`restores ${writer} ${scope} same-period eligibility without resetting incurred money, holds or quotes`, async () => {
        const f = await scopeFixture(scope)
        const adverse = scope === 'pooled' ? 'unpaid' : 'paused'
        if (writer === 'adapter') await mutateScopeSubscription(writer, f, { status: 'past_due' })
        const binding = await scopeBinding(f)
        const original = await scopePeriod(binding)
        const one = { stepNumber: 0, retryCount: 0 }
        const held = { stepNumber: 1, retryCount: 0 }
        for (const occurrence of [one, held])
          await tx((bound) => policy.admitModelStep(bound, binding, occurrence, true))
        const before = await scopeSnapshot(f, binding)
        await mutateScopeSubscription(writer, f, { status: adverse })
        const suspended = await policy.readFinancialReceipt(
          db,
          ns(f.id),
          policy.periodKey(original)
        )
        expect(suspended).toMatchObject({
          recordType: 'period',
          closing: null,
          suspension: { allowanceUsd: '40', mode: scope, defaultGrant: false },
        })
        await expect(scopeBinding(f)).rejects.toThrow('subscription')
        await expect(
          tx((bound) =>
            policy.admitModelStep(bound, binding, { stepNumber: 2, retryCount: 0 }, true)
          )
        ).rejects.toThrow('subscription')
        await acceptScopeAmount(binding, one, '0.3')
        const settled = await scopeSnapshot(f, binding)
        await acceptScopeAmount(binding, one, '0.3')
        expect(await scopeSnapshot(f, binding)).toEqual(settled)
        expect(settled.organizationLedger).toMatchObject({
          totalCost: '0.3',
          currentPeriodCost: '0.3',
          lastPeriodCost: '0',
        })
        expect(settled.late).toMatchObject({ holdState: 'outstanding', contactState: 'uncertain' })
        expect(settled.invocation).toEqual(before.invocation)
        expect(
          await tx((bound) =>
            policy.financialUsageNotificationFacts(
              bound,
              ns(f.id),
              policy.occurrenceKey(binding, one)
            )
          )
        ).toBeNull()
        expect(
          await tx((bound) =>
            policy.evaluateFinancialPeriod(bound, ns(f.id), policy.periodKey(original), 'threshold')
          )
        ).toBeNull()
        await mutateScopeSubscription(writer, f, { status: adverse })
        expect(await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(original))).toEqual(
          suspended
        )
        await mutateScopeSubscription(writer, f, { status: 'active' })
        const restored = await scopeSnapshot(f, binding)
        expect(restored.organizationLedger).toEqual(settled.organizationLedger)
        expect(restored.memberLedger).toEqual(settled.memberLedger)
        expect(restored.head).toEqual(settled.head)
        expect(restored.invocation).toEqual(settled.invocation)
        expect(restored.late).toEqual(settled.late)
        const basis = await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(original))
        expect(basis?.recordType === 'period' && basis.suspension).toBeUndefined()
        const fresh = await scopeBinding(f)
        await tx((bound) => policy.admitModelStep(bound, fresh, one, true))
        await tx((bound) =>
          policy.admitModelStep(bound, binding, { stepNumber: 2, retryCount: 0 }, true)
        )
        await mutateScopeSubscription(writer, f, { status: 'active' })
        expect(await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(original))).toEqual(
          basis
        )
        await mutateScopeSubscription(writer, f, { status: adverse })
        await mutateScopeSubscription(writer, f, { status: 'canceled' })
        const closed = await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(original))
        expect(closed).toMatchObject({
          recordType: 'period',
          closing: { mode: scope, allowanceUsd: '40', acceptedUsd: '0.3' },
        })
        expect(closed?.recordType === 'period' && closed.suspension).toBeUndefined()
        await acceptScopeAmount(binding, held, '0.1')
        expect(await tx((bound) => policy.verifyAcceptance(bound, binding, held))).toMatchObject({
          accepted: true,
          appliedUsd: '0.1',
        })
        await expect(mutateScopeSubscription(writer, f, { status: 'active' })).rejects.toThrow(
          'reopened'
        )
        await expect(
          tx((bound) =>
            policy.admitModelStep(bound, binding, { stepNumber: 3, retryCount: 0 }, true)
          )
        ).rejects.toThrow('subscription')
      })
    }
    it(`rolls ${writer} suspension and restoration back with the actual caller transaction`, async () => {
      const f = await scopeFixture('pooled')
      const binding = await cost(f)
      const before = await scopeSnapshot(f, binding)
      const { updateFinancialSubscription } = await import('./financial-subscriptions')
      // The adapter uses its actual public transaction method; direct mutation accepts the same bound tx.
      const fail = async (status: string) => {
        if (writer === 'direct')
          await rollbackProbe((bound) =>
            updateFinancialSubscription(f.subId, { status }, { transaction: bound }).then(
              () => undefined
            )
          )
        else {
          await expect(rollbackAdapterSubscription(f.subId, status)).rejects.toThrow(
            'Intentional disposable corruption rollback'
          )
        }
      }
      await fail('unpaid')
      expect(await scopeSnapshot(f, binding)).toEqual(before)
      await mutateScopeSubscription(writer, f, { status: 'unpaid' })
      const suspended = await scopeSnapshot(f, binding)
      const original = await scopePeriod(binding)
      const basis = await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(original))
      await fail('active')
      expect(await scopeSnapshot(f, binding)).toEqual(suspended)
      expect(await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(original))).toEqual(
        basis
      )
      await mutateScopeSubscription(writer, f, { status: 'active' })
    })
    it(`enforces ${writer} fixed quantity on actual create/update without inflating included allowance`, async () => {
      const f = await organizationFixture(3, 'pooled')
      const [original] = await db
        .select()
        .from(tables.subscription)
        .where(eq(tables.subscription.referenceId, f.id))
      const before = asJson(original)
      const { createFinancialSubscription, updateFinancialSubscription } = await import(
        './financial-subscriptions'
      )
      const update = (seats: number | null) =>
        writer === 'adapter'
          ? adapter.update({
              model: 'subscription',
              where: [{ field: 'id', value: original.id }],
              update: { seats },
            })
          : updateFinancialSubscription(original.id, { seats })
      for (const seats of [100, 2]) {
        await expect(update(seats)).rejects.toThrow('fixed tier quantity')
        expect(
          asJson(
            (
              await db
                .select()
                .from(tables.subscription)
                .where(eq(tables.subscription.id, original.id))
            )[0]
          )
        ).toEqual(before)
      }
      const newRoot = await pristineOrganizationFixture()
      const candidate = {
        id: `${newRoot.tag}-sub`,
        plan: original.plan,
        billingTierId: original.plan,
        referenceType: 'organization' as const,
        referenceId: newRoot.id,
        stripeCustomerId: `cus_${newRoot.tag}`,
        stripeSubscriptionId: `sub_${newRoot.tag}`,
        periodStart: original.periodStart,
        periodEnd: original.periodEnd,
        status: 'active',
        seats: 100,
      }
      const create = (seats: number | null) =>
        writer === 'adapter'
          ? adapter.create({ model: 'subscription', data: { ...candidate, seats } })
          : createFinancialSubscription({ ...candidate, seats })
      await expect(create(100)).rejects.toThrow('fixed tier quantity')
      expect(
        await db
          .select()
          .from(tables.subscription)
          .where(eq(tables.subscription.referenceId, newRoot.id))
      ).toEqual([])
      await create(null)
      const [created] = await db
        .select()
        .from(tables.subscription)
        .where(eq(tables.subscription.referenceId, newRoot.id))
      expect(created.seats).toBeNull()
      await update(null)
      const binding = await cost(f)
      const originalPeriod = await scopePeriod(binding)
      await updateFinancialSubscription(original.id, { status: 'unpaid' })
      expect(
        await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(originalPeriod))
      ).toMatchObject({ suspension: { allowanceUsd: '20' } })
      await updateFinancialSubscription(original.id, { status: 'active', seats: 3 })
      expect(
        (
          await db.select().from(tables.subscription).where(eq(tables.subscription.id, original.id))
        )[0].seats
      ).toBe(3)
    })
  }
  it('rolls an actual adapter bulk fixed-seat conflict back across all original roots', async () => {
    const a = await organizationFixture(3)
    const b = await organizationFixture(3)
    const rows = await db
      .select()
      .from(tables.subscription)
      .where(sql`${tables.subscription.referenceId} IN (${a.id}, ${b.id})`)
    const before = asJson(rows)
    await expect(
      adapter.updateMany({
        model: 'subscription',
        where: [{ field: 'id', operator: 'in', value: rows.map((row) => row.id) }],
        update: { seats: 100 },
      })
    ).rejects.toThrow('fixed tier quantity')
    expect(
      asJson(
        await db
          .select()
          .from(tables.subscription)
          .where(sql`${tables.subscription.referenceId} IN (${a.id}, ${b.id})`)
      )
    ).toEqual(before)
  })
  for (const first of ['acceptance', 'loss'] as const) {
    it(`serializes actual eligibility loss with ${first} first and settles the same original posting once`, async () => {
      const f = await scopeFixture('individual')
      const binding = await scopeBinding(f)
      await tx((bound) => policy.admitModelStep(bound, binding, firstScopeOccurrence, true))
      let announce!: (pid: number) => void
      let release!: () => void
      const locked = new Promise<number>((resolve) => {
        announce = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const holder = tx(async (bound) => {
        await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
        const [row] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
        announce(Number(row.pid))
        await gate
      })
      const blocker = await locked
      const accepting = () => acceptScopeAmount(binding, firstScopeOccurrence, '0.3')
      const losing = () => mutateScopeSubscription('adapter', f, { status: 'unpaid' })
      const earlier = Promise.allSettled([first === 'acceptance' ? accepting() : losing()])
      let later: Promise<PromiseSettledResult<unknown>[]> | undefined
      try {
        const waiting = await waitForBlockedSession(blocker)
        later = Promise.allSettled([first === 'acceptance' ? losing() : accepting()])
        await waitForBlockedSession(waiting)
      } finally {
        release()
        await Promise.allSettled([holder, earlier, ...(later ? [later] : [])])
      }
      expect((await earlier)[0].status).toBe('fulfilled')
      expect(later && (await later)[0].status).toBe('fulfilled')
      expect(
        await tx((bound) => policy.verifyAcceptance(bound, binding, firstScopeOccurrence))
      ).toMatchObject({ accepted: true, appliedUsd: '0.3' })
      expect((await scopeSnapshot(f, binding)).organizationLedger.currentPeriodCost).toBe('0.3')
      await mutateScopeSubscription('adapter', f, { status: 'active' })
    })
  }
  for (const first of ['failure', 'payment'] as const) {
    it(`serializes RAW exported invoice settlement with ${first} first without an app prelock`, async () => {
      const f = await baseInvoiceFixture()
      const id = `in_${randomUUID()}`
      const target = await tx((bound) =>
        policy.registerSubscriptionInvoice(bound, {
          root: { type: 'organization', id: f.id },
          period: f.period,
          invoiceId: id,
          amountCents: '3500',
          currency: 'usd',
        })
      )
      const before = await baseInvoiceMoney(f)
      const settle = (paid: boolean) =>
        tx((bound) =>
          policy.acceptInvoicePayment(bound, {
            namespace: target.namespace,
            key: target.key,
            invoiceId: id,
            customerId: f.period.customerId!,
            amountCents: '3500',
            currency: 'usd',
            fingerprint: target.intent.fingerprint,
            period: f.period,
            paid,
          })
        )
      let announce!: (pid: number) => void
      let release!: () => void
      const locked = new Promise<number>((resolve) => {
        announce = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const holder = tx(async (bound) => {
        await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
        const [row] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
        announce(Number(row.pid))
        await gate
      })
      const blocker = await locked
      const earlier = Promise.allSettled([settle(first === 'payment')])
      let later: Promise<PromiseSettledResult<void>[]> | undefined
      try {
        const waiting = await waitForBlockedSession(blocker)
        later = Promise.allSettled([settle(first !== 'payment')])
        await waitForBlockedSession(waiting)
      } finally {
        release()
        await Promise.allSettled([holder, earlier, ...(later ? [later] : [])])
      }
      expect((await earlier)[0].status).toBe('fulfilled')
      expect(later && (await later)[0].status).toBe('fulfilled')
      const receipt = await policy.readFinancialReceipt(db, target.namespace, target.key)
      expect(receipt).toMatchObject({
        invoiceObligationState: 'closed',
        amountCents: '3500',
        period: f.period,
      })
      expect(
        receipt &&
          'markers' in receipt &&
          receipt.markers.filter((marker) => marker.id === `payment-failed:${id}`).length
      ).toBe(first === 'failure' ? 1 : 0)
      expect(await blockedBaseRoot(f)).toBe(false)
      expect(await baseInvoiceMoney(f)).toEqual(before)
      const closed = asJson(receipt)
      await settle(false)
      expect(asJson(await policy.readFinancialReceipt(db, target.namespace, target.key))).toEqual(
        closed
      )
      const debt = await tx((bound) =>
        policy.registerSubscriptionInvoice(bound, {
          root: { type: 'organization', id: f.id },
          period: f.period,
          invoiceId: `in_${randomUUID()}`,
          amountCents: '100',
          currency: 'usd',
        })
      )
      await tx((bound) =>
        policy.acceptInvoicePayment(bound, {
          namespace: debt.namespace,
          key: debt.key,
          invoiceId: debt.intent.invoiceId!,
          customerId: f.period.customerId!,
          amountCents: debt.intent.amountCents,
          currency: 'usd',
          fingerprint: debt.intent.fingerprint,
          period: f.period,
          paid: false,
          notifyFailure: false,
        })
      )
      await settle(true)
      expect(await blockedBaseRoot(f)).toBe(true)
      await expect(
        tx((bound) =>
          policy.acceptInvoicePayment(bound, {
            namespace: target.namespace,
            key: target.key,
            invoiceId: id,
            customerId: f.period.customerId!,
            amountCents: '3501',
            currency: 'usd',
            fingerprint: target.intent.fingerprint,
            period: f.period,
            paid: false,
          })
        )
      ).rejects.toThrow('binding mismatch')
      expect(await baseInvoiceMoney(f)).toEqual(before)
    })
  }

  it('retains actual consumed default grants and outstanding hold face values through personal same-period recovery', async () => {
    const userId = await person('r6-default-grant')
    const tierId = `${stamp}-default-${randomUUID()}`
    await db.insert(tables.systemBillingTier).values({
      id: tierId,
      displayName: 'Disposable default grant',
      description: 'Disposable exact grant restoration',
      status: 'active',
      ownerType: 'user',
      usageScope: 'individual',
      isDefault: true,
      includedUsageLimitUsd: '0',
    })
    const { createFinancialSubscription, updateFinancialSubscription } = await import(
      './financial-subscriptions'
    )
    const original = await createFinancialSubscription({
      id: `${tierId}-sub`,
      plan: tierId,
      billingTierId: tierId,
      referenceType: 'user',
      referenceId: userId,
      status: 'active',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      periodStart: null,
      periodEnd: null,
    })
    const make = (hold: string) =>
      tx((bound) =>
        policy.createInvocation(bound, {
          actorUserId: userId,
          runId: randomUUID(),
          operationKey: randomUUID(),
          purpose: 'copilot',
          quotedHoldUsd: hold,
          schedulerReady: true,
        })
      )
    const binding = await make('0.1')
    const period = await scopePeriod(binding)
    const first = { stepNumber: 0, retryCount: 0 }
    const incurred = { stepNumber: 1, retryCount: 0 }
    const uncertain = { stepNumber: 2, retryCount: 0 }
    for (const occurrence of [first, incurred, uncertain])
      await tx((bound) => policy.admitModelStep(bound, binding, occurrence, true))
    await acceptScopeAmount(binding, first, '0.1')
    await updateFinancialSubscription(original.id, { status: 'paused' })
    await acceptScopeAmount(binding, incurred, '0.05')
    const [during] = await db
      .select()
      .from(tables.userStats)
      .where(eq(tables.userStats.userId, userId))
    expect(during).toMatchObject({
      grantedOnboardingAllowanceUsd: '0.15',
      currentPeriodCost: '0.15',
      totalCost: '0.15',
    })
    const outstanding = await policy.readFinancialReceipt(
      db,
      binding.namespace,
      policy.occurrenceKey(binding, uncertain)
    )
    await expect(make('0.05')).rejects.toThrow('subscription')
    await updateFinancialSubscription(original.id, { status: 'active' })
    expect(
      (await db.select().from(tables.userStats).where(eq(tables.userStats.userId, userId)))[0]
    ).toEqual(during)
    expect(
      await policy.readFinancialReceipt(
        db,
        binding.namespace,
        policy.occurrenceKey(binding, uncertain)
      )
    ).toEqual(outstanding)
    const fresh = await make('0.05')
    await tx((bound) => policy.admitModelStep(bound, fresh, first, true))
    await expect(
      tx((bound) => policy.admitModelStep(bound, binding, { stepNumber: 3, retryCount: 0 }, true))
    ).rejects.toThrow('allowance')
    // The controlled fixture never delegated this contact; only this known proof closes its hold.
    await tx((bound) =>
      policy.releaseProvenUnused(bound, binding, uncertain, { refusedBeforeDelegation: true })
    )
    await tx((bound) =>
      policy.admitModelStep(bound, binding, { stepNumber: 3, retryCount: 0 }, true)
    )
    expect(
      (await db.select().from(tables.userStats).where(eq(tables.userStats.userId, userId)))[0]
        .grantedOnboardingAllowanceUsd
    ).toBe('0.15')
    const basis = await policy.readFinancialReceipt(db, binding.namespace, policy.periodKey(period))
    expect(basis?.recordType === 'period' && basis.suspension).toBeUndefined()
  })
  it('preserves pending and issued original invoice commitments throughout suspended evaluation and same-period restoration', async () => {
    const f = await scopeFixture('pooled')
    const binding = await cost(f, f.owner, '100')
    const period = await scopePeriod(binding)
    const first = await tx((bound) =>
      policy.evaluateFinancialPeriod(bound, ns(f.id), policy.periodKey(period), 'threshold')
    )
    if (first?.recordType !== 'invoice')
      throw new Error('Actual pending original threshold intent required')
    expect(first.amountCents).toBe('6000')
    await mutateScopeSubscription('direct', f, { status: 'unpaid' })
    expect(
      await tx((bound) =>
        policy.evaluateFinancialPeriod(bound, ns(f.id), policy.periodKey(period), 'threshold')
      )
    ).toBeNull()
    const pending = await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(period))
    expect(pending).toMatchObject({ commitments: { pendingUsd: '60', issuedUsd: '0' } })
    await mutateScopeSubscription('direct', f, { status: 'active' })
    expect(await policy.readFinancialReceipt(db, ns(f.id), first.requestKey)).toBeNull()
    const restored = await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(period))
    expect(restored).toMatchObject({ commitments: { pendingUsd: '60', issuedUsd: '0' } })
    await expect(
      scopeBinding(f).then((next) =>
        tx((bound) => policy.admitModelStep(bound, next, firstScopeOccurrence, true))
      )
    ).rejects.toThrow('allowance')
    const candidates = await policy.listFinancialDispatch(db, Date.now())
    const entry = candidates.find(
      (candidate) => candidate.namespace === ns(f.id) && candidate.key.startsWith('invoice:')
    )
    if (!entry) throw new Error('Indexed original pending invoice key required')
    // A synthetic known provider acknowledgement exercises existing canonical issued reservation, no HTTP.
    await tx((bound) =>
      policy.acknowledgeInvoiceIssued(bound, entry.namespace, entry.key, `in_r6_${randomUUID()}`)
    )
    await mutateScopeSubscription('direct', f, { status: 'paused' })
    await mutateScopeSubscription('direct', f, { status: 'active' })
    expect(await policy.readFinancialReceipt(db, ns(f.id), policy.periodKey(period))).toMatchObject(
      { commitments: { pendingUsd: '0', issuedUsd: '60' } }
    )
  })

  for (const first of ['creator', 'deleter'] as const) {
    it(`preserves the canonical workspace-log FK boundary with ${first} first, without native contact`, async () => {
      const { assertWorkspaceArchiveDeletionInTx, ArchivePruneDeferredError } = await import(
        '@/lib/workflow-archive/lifecycle'
      )
      const ownerId = await person(`r6-fk-${first}`)
      const workspaceId = `${stamp}-fk-${randomUUID()}`
      const snapshotWorkspaceId = `${workspaceId}-snapshot`
      await db.insert(tables.workspace).values([
        {
          id: workspaceId,
          name: 'Disposable FK target',
          ownerId,
          billingOwnerType: 'user',
          billingOwnerUserId: ownerId,
        },
        {
          id: snapshotWorkspaceId,
          name: 'Disposable independent snapshot anchor',
          ownerId,
          billingOwnerType: 'user',
          billingOwnerUserId: ownerId,
        },
      ])
      const snapshotId = `${workspaceId}-state`
      // Independent stable snapshot isolates this test's workspace-log FK from snapshot-cascade locks.
      // This is a SQL cascade oracle, not a claim of valid native payload ownership or a native join.
      await db.insert(tables.workflowExecutionSnapshots).values({
        id: snapshotId,
        workspaceId: snapshotWorkspaceId,
        stateHash: snapshotId,
        stateData: {},
      })
      const logId = `${workspaceId}-log`
      const value = {
        id: logId,
        workspaceId,
        executionId: `${logId}-execution`,
        stateSnapshotId: snapshotId,
        workflowSummary: {},
        level: 'info',
        trigger: 'manual',
        startedAt: new Date(),
      }
      const previous = process.env.WORKFLOW_ADMISSIONS_CLOSED
      process.env.WORKFLOW_ADMISSIONS_CLOSED = 'true'
      let announce!: (pid: number) => void
      let release!: () => void
      const locked = new Promise<number>((resolve) => {
        announce = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const earlier = tx(async (bound) => {
        if (first === 'creator') await bound.insert(tables.workflowExecutionLogs).values(value)
        else await assertWorkspaceArchiveDeletionInTx(bound, workspaceId)
        const [row] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
        if (typeof row.pid !== 'number') throw new Error('Actual FK schedule PID unavailable')
        announce(row.pid)
        await gate
        if (first === 'deleter')
          await bound.delete(tables.workspace).where(eq(tables.workspace.id, workspaceId))
      })
      let later: Promise<PromiseSettledResult<unknown>[]> | undefined
      try {
        const blocker = await locked
        later = Promise.allSettled([
          tx(async (bound) => {
            if (first === 'creator') await assertWorkspaceArchiveDeletionInTx(bound, workspaceId)
            else await bound.insert(tables.workflowExecutionLogs).values(value)
          }),
        ])
        await waitForBlockedSession(blocker)
      } finally {
        release()
        await Promise.allSettled([earlier, ...(later ? [later] : [])])
        if (previous === undefined)
          Reflect.deleteProperty(process.env, 'WORKFLOW_ADMISSIONS_CLOSED')
        else process.env.WORKFLOW_ADMISSIONS_CLOSED = previous
      }
      await earlier
      if (!later) throw new Error('Actual FK waiter was not launched')
      const [outcome] = await later
      expect(outcome.status).toBe('rejected')
      if (outcome.status !== 'rejected') throw new Error('Retained log boundary did not refuse')
      if (first === 'creator') expect(outcome.reason).toBeInstanceOf(ArchivePruneDeferredError)
      else expect(outcome.reason).toMatchObject({ cause: { code: '23503' } })
      expect(
        (await db.select().from(tables.workspace).where(eq(tables.workspace.id, workspaceId)))
          .length
      ).toBe(first === 'creator' ? 1 : 0)
      expect(
        (
          await db
            .select()
            .from(tables.workflowExecutionLogs)
            .where(eq(tables.workflowExecutionLogs.id, logId))
        ).length
      ).toBe(first === 'creator' ? 1 : 0)
    })
  }
  // R7: real configured signature verification and current app settlement; no provider contact.
  const webhookSecret = 'whsec_source_r7_signature_only'
  let configuredWebhook: ((request: Request) => Promise<Response>) | undefined
  async function webhook(
    invoice: Record<string, unknown>,
    type: Stripe.Event.Type,
    signature?: string
  ) {
    if (!configuredWebhook) {
      const runtime = await import('@/lib/system-services/stripe-runtime')
      const client = new Stripe('sk_test_source_r7_signature_only', {
        maxNetworkRetries: 0,
        httpClient: Stripe.createFetchHttpClient(async () => {
          contacts++
          throw new Error('No Stripe provider contact belongs to signed source tests')
        }),
      })
      vi.spyOn(runtime, 'createStripeClientProxy').mockReturnValue(client)
      vi.spyOn(runtime, 'getStripeServiceConfig').mockReturnValue({
        secretKey: null,
        webhookSecret,
      })
      const { auth } = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
      configuredWebhook = toNextJsHandler(auth.handler).POST
    }
    const signer = new Stripe('sk_test_source_r7_signature_only')
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: 'event',
      api_version: '2025-08-27.basil',
      type,
      data: { object: invoice },
    })
    const header =
      signature ?? signer.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })
    return configuredWebhook(
      new Request('http://127.0.0.1:1/api/auth/stripe/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': header },
        body: payload,
      })
    )
  }
  async function acceptedWebhook(invoice: Record<string, unknown>, type: Stripe.Event.Type) {
    const response = await webhook(invoice, type)
    const body = await response.json()
    expect({ status: response.status, body }).toEqual({ status: 200, body: { success: true } })
  }
  const paidInvoice = <T extends Record<string, unknown>>(invoice: T) => ({
    ...invoice,
    status: 'paid',
    amount_paid: invoice.total,
    paid_out_of_band: true,
  })
  async function overageWebhookFixture() {
    const f = await invoiceFixture()
    const invoice = {
      id: `in_${randomUUID()}`,
      object: 'invoice',
      status: 'open',
      customer: f.period.customerId,
      currency: f.intent.currency,
      total: centsToProviderNumber(f.intent.amountCents),
      amount_paid: 0,
      attempt_count: 1,
      metadata: {
        type: 'overage_billing',
        financialNamespace: f.candidate.namespace,
        financialKey: f.candidate.key,
        financialFingerprint: f.intent.fingerprint,
        subscriptionId: f.period.stripeSubscriptionId,
        periodStart: f.period.start,
        periodEnd: f.period.end,
      },
    }
    await acceptedWebhook(invoice, 'invoice.finalized')
    const read = () => policy.readFinancialReceipt(db, f.candidate.namespace, f.candidate.key)
    return { f, invoice, read }
  }
  async function r10FinancialSnapshot(
    f: { id: string; owner: string },
    store: Pick<policy.FinancialTransaction, 'select'> = db
  ) {
    return asJson({
      organization: await store
        .select()
        .from(tables.organization)
        .where(eq(tables.organization.id, f.id)),
      subscriptions: await store
        .select()
        .from(tables.subscription)
        .where(
          and(
            eq(tables.subscription.referenceType, 'organization'),
            eq(tables.subscription.referenceId, f.id)
          )
        )
        .orderBy(tables.subscription.id),
      organizationLedger: await store
        .select()
        .from(tables.organizationBillingLedger)
        .where(eq(tables.organizationBillingLedger.organizationId, f.id)),
      memberLedgers: await store
        .select()
        .from(tables.organizationMemberBillingLedger)
        .where(eq(tables.organizationMemberBillingLedger.organizationId, f.id))
        .orderBy(tables.organizationMemberBillingLedger.userId),
      originalUserStats: await store
        .select()
        .from(tables.userStats)
        .where(eq(tables.userStats.userId, f.owner)),
      receipts: await store
        .select()
        .from(tables.idempotencyKey)
        .where(eq(tables.idempotencyKey.namespace, ns(f.id)))
        .orderBy(tables.idempotencyKey.key),
    })
  }
  async function r11MemberBasisFixture() {
    const f = await organizationFixture()
    const retained = await person('r11-retained')
    await adapter.create({
      model: 'member',
      data: { organizationId: f.id, userId: retained, role: 'member', createdAt: new Date() },
    })
    await db.insert(tables.permissions).values({
      id: randomUUID(),
      entityType: 'workspace',
      entityId: f.workspaceId,
      userId: retained,
      permissionType: 'write',
    })
    const hold = await tx((bound) =>
      policy.createInvocation(bound, {
        actorUserId: f.owner,
        workspaceId: f.workspaceId,
        runId: randomUUID(),
        operationKey: randomUUID(),
        purpose: 'copilot',
        quotedHoldUsd: '0.3',
        schedulerReady: true,
      })
    )
    await tx((bound) => policy.admitModelStep(bound, hold, firstScopeOccurrence, true))
    const first = await cost(f, f.owner, '80')
    const second = await cost(f, retained, '100')
    const period = await scopePeriod(first)
    return { ...f, retained, hold, first, second, period, key: policy.periodKey(period) }
  }
  for (const implementation of ['current-build', 'installed-final-tar'] as const) {
    it(`R11 raw ${implementation} evaluator includes departed retained liabilities and preserves pending/issued reservations`, async () => {
      const f = await r11MemberBasisFixture()
      await adapter.delete({
        model: 'member',
        where: [
          { field: 'organizationId', value: f.id },
          { field: 'userId', value: f.retained },
        ],
      })
      expect(await ledger(f.id, f.retained)).toBeDefined()
      const api = implementation === 'current-build' ? currentBuiltPolicy : policy
      const invoice = await tx((bound) =>
        api.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'threshold')
      )
      if (invoice?.recordType !== 'invoice')
        throw new Error('Actual complete original invoice required')
      expect(invoice).toMatchObject({
        amountCents: '14000',
        root: { type: 'organization', id: f.id },
        period: f.period,
      })
      expect(
        await tx((bound) => api.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'threshold'))
      ).toBeNull()
      expect(await policy.readFinancialReceipt(db, ns(f.id), f.key)).toMatchObject({
        commitments: { pendingUsd: '140', issuedUsd: '0' },
      })
      const basis = await policy.readFinancialReceipt(db, ns(f.id), f.key)
      if (basis?.recordType !== 'period') throw new Error('Actual original invoice prefix required')
      await tx((bound) =>
        policy.acknowledgeInvoiceIssued(
          bound,
          ns(f.id),
          `${basis.invoicePrefix}${invoice.fingerprint}`,
          `in_r11_${randomUUID()}`
        )
      )
      expect(await policy.readFinancialReceipt(db, ns(f.id), f.key)).toMatchObject({
        commitments: { pendingUsd: '0', issuedUsd: '140' },
      })
      expect(
        await tx((bound) => api.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'threshold'))
      ).toBeNull()
      expect(
        await policy.readFinancialReceipt(
          db,
          f.hold.namespace,
          policy.occurrenceKey(f.hold, firstScopeOccurrence)
        )
      ).toMatchObject({ contactState: 'uncertain', holdState: 'outstanding' })
      await adapter.create({
        model: 'member',
        data: { organizationId: f.id, userId: f.retained, role: 'member', createdAt: new Date() },
      })
      expect((await ledger(f.id, f.retained))?.currentPeriodCost).toBe('100')
    })
  }
  it('R11 frozen original individual basis is not reconstructed from present member money', async () => {
    const f = await r11MemberBasisFixture()
    await tx((bound) =>
      policy.closeFinancialPeriod(bound, { type: 'organization', id: f.id }, f.period)
    )
    await rollbackProbe(async (bound) => {
      await bound
        .update(tables.organizationMemberBillingLedger)
        .set({ currentPeriodCost: '0' })
        .where(eq(tables.organizationMemberBillingLedger.organizationId, f.id))
      expect(await policy.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'final')).toMatchObject({
        amountCents: '14000',
        subtype: 'final',
      })
    })
    await rollbackProbe(async (bound) => {
      const original = await policy.readFinancialReceipt(bound, ns(f.id), f.key)
      if (original?.recordType !== 'period' || !original.closing)
        throw new Error('Actual frozen period required')
      const raw = asJson(original)
      raw.closing.mode = 'user'
      await bound
        .update(tables.idempotencyKey)
        .set({ result: raw })
        .where(
          and(eq(tables.idempotencyKey.namespace, ns(f.id)), eq(tables.idempotencyKey.key, f.key))
        )
      const before = await r10FinancialSnapshot(f, bound)
      await expect(policy.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'final')).rejects.toThrow(
        'period changed'
      )
      expect(await r10FinancialSnapshot(f, bound)).toEqual(before)
    })
  })
  for (const authority of ['live', 'suspended', 'frozen'] as const) {
    it(`R11 raw installed evaluator refuses missing retained targets on ${authority} authority without financial mutation`, async () => {
      const f = await r11MemberBasisFixture()
      if (authority === 'suspended')
        await (await import('./financial-subscriptions')).updateFinancialSubscription(
          f.period.subscriptionId,
          { status: 'unpaid' }
        )
      if (authority === 'frozen')
        await tx((bound) =>
          policy.closeFinancialPeriod(bound, { type: 'organization', id: f.id }, f.period)
        )
      await rollbackProbe(async (bound) => {
        await bound
          .delete(tables.organizationMemberBillingLedger)
          .where(
            and(
              eq(tables.organizationMemberBillingLedger.organizationId, f.id),
              eq(tables.organizationMemberBillingLedger.userId, f.retained)
            )
          )
        const before = await r10FinancialSnapshot(f, bound)
        await expect(
          policy.evaluateFinancialPeriod(
            bound,
            ns(f.id),
            f.key,
            authority === 'frozen' ? 'final' : 'threshold'
          )
        ).rejects.toMatchObject({ integrityCode: 'incomplete-member-basis' })
        expect(await r10FinancialSnapshot(f, bound)).toEqual(before)
      })
    })
  }
  for (const corruption of [
    'missing-registry',
    'missing-pair',
    'foreign-pair',
    'foreign-anchor',
    'orphan-ledger',
    'unregistered-current',
    'duplicate-current',
    'missing-root-ledger',
  ] as const) {
    it(`R11 raw evaluator refuses ${corruption} original basis without seeding or partial billing`, async () => {
      const f = await r11MemberBasisFixture()
      const stranger = await person('r11-unregistered')
      await rollbackProbe(async (bound) => {
        const pairKey = policy.memberRegistrationKey(f.retained)
        if (corruption === 'missing-registry' || corruption === 'missing-pair')
          await bound
            .delete(tables.idempotencyKey)
            .where(
              and(
                eq(tables.idempotencyKey.namespace, ns(f.id)),
                eq(
                  tables.idempotencyKey.key,
                  corruption === 'missing-registry' ? policy.memberRegistryKey : pairKey
                )
              )
            )
        else if (corruption === 'foreign-pair' || corruption === 'foreign-anchor') {
          const pair = await policy.readFinancialReceipt(bound, ns(f.id), pairKey)
          if (pair?.recordType !== 'member-registration')
            throw new Error('Actual retained registration required')
          const raw = asJson(pair)
          if (corruption === 'foreign-pair') raw.root.id = stranger
          else raw.ledgerAnchor = 'a'.repeat(64)
          await bound
            .update(tables.idempotencyKey)
            .set({ result: raw })
            .where(
              and(
                eq(tables.idempotencyKey.namespace, ns(f.id)),
                eq(tables.idempotencyKey.key, pairKey)
              )
            )
        } else if (corruption === 'orphan-ledger')
          await bound
            .insert(tables.organizationMemberBillingLedger)
            .values({ organizationId: f.id, userId: stranger })
        else if (corruption === 'unregistered-current' || corruption === 'duplicate-current')
          await bound.insert(tables.member).values({
            id: randomUUID(),
            organizationId: f.id,
            userId: corruption === 'duplicate-current' ? f.retained : stranger,
            role: 'member',
            createdAt: new Date(),
          })
        else
          await bound
            .delete(tables.organizationBillingLedger)
            .where(eq(tables.organizationBillingLedger.organizationId, f.id))
        const before = await r10FinancialSnapshot(f, bound)
        await expect(
          policy.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'threshold')
        ).rejects.toMatchObject({ integrityCode: 'incomplete-member-basis' })
        expect(await r10FinancialSnapshot(f, bound)).toEqual(before)
      })
    })
  }
  for (const missing of ['organization', 'foreign-period-root'] as const) {
    it(`R11 raw evaluator refuses ${missing} original owner rather than recreating a target`, async () => {
      const f = await r11MemberBasisFixture()
      await rollbackProbe(async (bound) => {
        if (missing === 'organization') {
          expect(
            await bound
              .select({
                id: tables.workspace.id,
                ownerId: tables.workspace.ownerId,
                billingOwnerOrganizationId: tables.workspace.billingOwnerOrganizationId,
              })
              .from(tables.workspace)
              .where(eq(tables.workspace.id, f.workspaceId))
          ).toEqual([{ id: f.workspaceId, ownerId: f.owner, billingOwnerOrganizationId: f.id }])
          expect(
            await bound
              .select({ id: tables.workflow.id })
              .from(tables.workflow)
              .where(eq(tables.workflow.workspaceId, f.workspaceId))
          ).toHaveLength(0)
          expect(
            await bound
              .select({ id: tables.workflowExecutionLogs.id })
              .from(tables.workflowExecutionLogs)
              .where(eq(tables.workflowExecutionLogs.workspaceId, f.workspaceId))
          ).toHaveLength(0)
          const removed = await bound
            .delete(tables.workspace)
            .where(
              and(
                eq(tables.workspace.id, f.workspaceId),
                eq(tables.workspace.ownerId, f.owner),
                eq(tables.workspace.billingOwnerOrganizationId, f.id)
              )
            )
            .returning({ id: tables.workspace.id })
          expect(removed).toEqual([{ id: f.workspaceId }])
          await bound.delete(tables.organization).where(eq(tables.organization.id, f.id))
        } else {
          const basis = await policy.readFinancialReceipt(bound, ns(f.id), f.key)
          if (basis?.recordType !== 'period') throw new Error('Actual period required')
          await bound
            .update(tables.idempotencyKey)
            .set({ result: asJson({ ...basis, root: { type: 'organization', id: randomUUID() } }) })
            .where(
              and(
                eq(tables.idempotencyKey.namespace, ns(f.id)),
                eq(tables.idempotencyKey.key, f.key)
              )
            )
        }
        const before = await r10FinancialSnapshot(f, bound)
        await expect(
          policy.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'final')
        ).rejects.toThrow()
        expect(await r10FinancialSnapshot(f, bound)).toEqual(before)
      })
    })
  }
  for (const field of ['namespace', 'key'] as const) {
    it(`R11 raw evaluator rejects a conflicting supplied ${field}`, async () => {
      const f = await r11MemberBasisFixture()
      const before = await r10FinancialSnapshot(f)
      await expect(
        tx((bound) =>
          policy.evaluateFinancialPeriod(
            bound,
            field === 'namespace' ? `${ns(f.id)}-foreign` : ns(f.id),
            field === 'key' ? 'period:foreign' : f.key,
            'final'
          )
        )
      ).rejects.toThrow('target invalid')
      expect(await r10FinancialSnapshot(f)).toEqual(before)
    })
  }
  it('R11 canonical member-ledger primary key rejects a duplicate exact pair', async () => {
    const f = await r11MemberBasisFixture()
    const before = await r10FinancialSnapshot(f)
    await expect(
      db.transaction((bound) =>
        bound
          .insert(tables.organizationMemberBillingLedger)
          .values({ organizationId: f.id, userId: f.retained })
      )
    ).rejects.toHaveProperty('cause.code', '23505')
    expect(await r10FinancialSnapshot(f)).toEqual(before)
  })
  for (const first of ['membership-writer', 'raw-evaluator'] as const) {
    it(`R11 serializes original root/member evaluation with ${first} first and retains departed liability`, async () => {
      const f = await r11MemberBasisFixture()
      const { mutateOrganizationFinancialScope } = await import('./financial-membership')
      let entered!: () => void
      let release!: () => void
      const ready = new Promise<void>((resolve) => {
        entered = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let holderPid = 0
      const remove = () =>
        mutateOrganizationFinancialScope(
          f.id,
          async (bound) => {
            const [{ pid }] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
            if (first === 'membership-writer') holderPid = Number(pid)
            await bound
              .delete(tables.member)
              .where(
                and(eq(tables.member.organizationId, f.id), eq(tables.member.userId, f.retained))
              )
            if (first === 'membership-writer') {
              entered()
              await gate
            }
          },
          { actorUserId: f.owner, targetUserId: f.retained }
        )
      const evaluate = () =>
        db.transaction(async (bound) => {
          const result = await policy.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'threshold')
          if (first === 'raw-evaluator') {
            const [{ pid }] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
            holderPid = Number(pid)
            entered()
            await gate
          }
          return result
        })
      const held = first === 'membership-writer' ? remove() : evaluate()
      let waiting: ReturnType<typeof remove> | ReturnType<typeof evaluate> | undefined
      try {
        await Promise.race([
          ready,
          held.then(() => {
            throw new Error('Expected actual root holder')
          }),
        ])
        waiting = first === 'membership-writer' ? evaluate() : remove()
        expect(await waitForBlockedSession(holderPid)).toBeGreaterThan(0)
      } finally {
        release()
      }
      const settled = await Promise.allSettled([held, waiting])
      expect(settled.every((value) => value.status === 'fulfilled')).toBe(true)
      const invoice = await tx((bound) =>
        policy.evaluateFinancialPeriod(bound, ns(f.id), f.key, 'threshold')
      )
      expect(invoice).toBeNull()
      expect(await policy.readFinancialReceipt(db, ns(f.id), f.key)).toMatchObject({
        commitments: { pendingUsd: '140', issuedUsd: '0' },
      })
      expect((await ledger(f.id, f.retained))?.currentPeriodCost).toBe('100')
    })
  }
  it('R11 actual drain classifies missing OTHER original target and retains protected financial evidence/backoff', async () => {
    const f = await r11MemberBasisFixture()
    await tx(async (bound) => {
      await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
      await bound
        .delete(tables.organizationMemberBillingLedger)
        .where(
          and(
            eq(tables.organizationMemberBillingLedger.organizationId, f.id),
            eq(tables.organizationMemberBillingLedger.userId, f.retained)
          )
        )
    })
    const candidate = {
      namespace: ns(f.id),
      key: policy.occurrenceKey(f.first, firstScopeOccurrence),
      due: Date.now(),
    }
    const original = await r8Raw(candidate)
    const before = await r10FinancialSnapshot(f)
    await expect(
      tx((bound) => policy.claimFinancialDispatch(bound, candidate, Date.now()))
    ).rejects.toMatchObject({ integrityCode: 'incomplete-member-basis' })
    const execute = await r8DefaultExecute()
    let incorrectExecutions = 0
    await r8ClassifyingDrain(candidate, {
      execute: async (claim, deadline) => {
        if (claim.candidate.namespace === candidate.namespace) {
          incorrectExecutions++
          throw new Error('Incomplete original member basis reached execution')
        }
        return execute(claim, deadline)
      },
    })
    expect(incorrectExecutions).toBe(0)
    const classified = await r8Raw(candidate)
    expect(classified.dispatchIntegrity).toMatchObject({
      code: 'incomplete-member-basis',
      reviews: 1,
    })
    expect(classified.markers).toEqual(original.markers)
    const review = classified.dispatchIntegrity as policy.DispatchIntegrityReview
    expect(
      await tx((bound) =>
        policy.classifyFinancialDispatch(
          bound,
          candidate,
          policy.financialFingerprint(classified),
          review.nextReviewAtMs
        )
      )
    ).toMatchObject({ status: 'classified', code: 'incomplete-member-basis' })
    expect((await r8Raw(candidate)).dispatchIntegrity).toMatchObject({
      evidenceFingerprint: review.evidenceFingerprint,
      firstObservedAtMs: review.firstObservedAtMs,
      reviews: 2,
    })
    const after = await r10FinancialSnapshot(f)
    expect(after.organizationLedger).toEqual(before.organizationLedger)
    expect(after.memberLedgers).toEqual(before.memberLedgers)
    expect(after.subscriptions).toEqual(before.subscriptions)
    expect(
      await policy.readFinancialReceipt(
        db,
        f.hold.namespace,
        policy.occurrenceKey(f.hold, firstScopeOccurrence)
      )
    ).toMatchObject({ holdState: 'outstanding', contactState: 'uncertain' })
    await expect(
      tx((bound) =>
        policy.createInvocation(bound, {
          actorUserId: f.owner,
          workspaceId: f.workspaceId,
          runId: randomUUID(),
          operationKey: randomUUID(),
          purpose: 'copilot',
          schedulerReady: true,
        })
      )
    ).rejects.toThrow('integrity blocks')
  })
  it('R11 missing candidate-own monetary target remains unresolved without invented protected original authority', async () => {
    const f = await r11MemberBasisFixture()
    await tx(async (bound) => {
      await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
      await bound
        .delete(tables.organizationMemberBillingLedger)
        .where(
          and(
            eq(tables.organizationMemberBillingLedger.organizationId, f.id),
            eq(tables.organizationMemberBillingLedger.userId, f.owner)
          )
        )
    })
    const candidate = {
      namespace: ns(f.id),
      key: policy.occurrenceKey(f.first, firstScopeOccurrence),
      due: Date.now(),
    }
    const original = await r8Raw(candidate)
    await expect(
      tx((bound) => policy.claimFinancialDispatch(bound, candidate, Date.now()))
    ).rejects.toMatchObject({ integrityCode: 'incomplete-member-basis' })
    expect(
      await tx((bound) =>
        policy.classifyFinancialDispatch(
          bound,
          candidate,
          policy.financialFingerprint(original),
          Date.now()
        )
      )
    ).toEqual({ status: 'unresolved', reason: 'unprovable-financial-record' })
    expect(await r8Raw(candidate)).toEqual(original)
  })
  const r10CreditTypes = [
    'invoice.paid',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'invoice.finalized',
  ] as const
  function r10CreditForEvent(
    invoice: Record<string, unknown>,
    type: (typeof r10CreditTypes)[number]
  ) {
    return {
      ...invoice,
      status: type === 'invoice.paid' || type === 'invoice.payment_succeeded' ? 'paid' : 'open',
      amount_paid: 0,
    }
  }
  for (const kind of ['subscription_item_details', 'invoice_item_details'] as const) {
    it(`R10 signed credit ${kind} across every handler leaves existing debt, outstanding hold and all financial rows unchanged`, async () => {
      const f = await baseInvoiceFixture()
      const binding = await scopeBinding(f)
      await tx((bound) => policy.admitModelStep(bound, binding, firstScopeOccurrence, true))
      const debt = baseInvoice(f, [baseInvoiceLine(f)])
      await acceptedWebhook(debt, 'invoice.finalized')
      await acceptedWebhook(debt, 'invoice.payment_failed')
      expect(await blockedBaseRoot(f)).toBe(true)
      const before = await r10FinancialSnapshot(f)
      const credit = baseInvoice(f, baseProrations(f, kind, undefined, undefined, 0), {
        total: -500,
      })
      const result = await (await import('./webhooks/invoices')).handleInvoiceFinalized(
        signedBaseInvoice(credit, 'invoice.finalized')
      )
      expect(result).toEqual({
        kind: 'verified-provider-credit',
        disposition: 'no-local-debit',
        invoiceId: credit.id,
        root: { type: 'organization', id: f.id },
        period: f.period,
        currency: 'usd',
        signedTotalCents: '-500',
        creditedInvoiceIds: [],
      })
      for (const type of [...r10CreditTypes, ...[...r10CreditTypes].reverse()]) {
        await acceptedWebhook(r10CreditForEvent(credit, type), type)
        expect(await r10FinancialSnapshot(f)).toEqual(before)
        expect(await policy.readSubscriptionInvoice(db, credit.id as string)).toBeNull()
      }
      expect(
        await policy.readFinancialReceipt(
          db,
          binding.namespace,
          policy.occurrenceKey(binding, firstScopeOccurrence)
        )
      ).toMatchObject({ contactState: 'uncertain', holdState: 'outstanding' })
      expect((await policy.readSubscriptionInvoice(db, debt.id as string))?.intent).toMatchObject({
        invoiceObligationState: 'open',
        amountCents: '3500',
      })
      expect(await blockedBaseRoot(f)).toBe(true)
    })
  }
  it('R10 genuine fresh current recurring credit classifies without creating a period basis, grant or receipt', async () => {
    const f = await baseInvoiceFixture()
    expect(await policy.readFinancialReceipt(db, ns(f.id), 'period-head')).toBeNull()
    const before = await r10FinancialSnapshot(f)
    const credit = baseInvoice(
      f,
      [baseInvoiceLine(f), { ...baseInvoiceLine(f, true, 'invoice_item_details'), amount: -4500 }],
      { total: -500 }
    )
    for (const type of r10CreditTypes) {
      await acceptedWebhook(r10CreditForEvent(credit, type), type)
      expect(await r10FinancialSnapshot(f)).toEqual(before)
      expect(await policy.readSubscriptionInvoice(db, credit.id as string)).toBeNull()
      expect(await policy.readFinancialReceipt(db, ns(f.id), 'period-head')).toBeNull()
    }
  })
  for (const total of [-0.5, Number.MIN_SAFE_INTEGER - 1, null, '-500']) {
    it(`R10 configured signed malformed TOTAL ${String(total)} cannot become credit success or seed financial state`, async () => {
      const f = await baseInvoiceFixture()
      const before = await r10FinancialSnapshot(f)
      const value = baseInvoice(f, baseProrations(f), { total })
      const response = await webhook(r10CreditForEvent(value, 'invoice.paid'), 'invoice.paid')
      expect(response.status).toBe(400)
      expect(await r10FinancialSnapshot(f)).toEqual(before)
      expect(await policy.readSubscriptionInvoice(db, value.id as string)).toBeNull()
    })
  }
  for (const variant of ['overage', 'retained-base'] as const) {
    it(`R10 negative TOTAL cannot bypass actual original ${variant} monetary authority`, async () => {
      const f = variant === 'overage' ? await overageWebhookFixture() : undefined
      const base = variant === 'retained-base' ? await baseInvoiceFixture() : undefined
      const owner = f?.f ?? base!
      const invoice = f?.invoice ?? baseInvoice(base!, [baseInvoiceLine(base!)])
      if (base) await acceptedWebhook(invoice, 'invoice.finalized')
      const before = await r10FinancialSnapshot(owner)
      for (const type of r10CreditTypes) {
        const response = await webhook(r10CreditForEvent({ ...invoice, total: -500 }, type), type)
        expect(response.status).toBe(400)
        expect(await r10FinancialSnapshot(owner)).toEqual(before)
      }
    })
  }
  it('R10 credit waiter observes a genuinely committed retained debit under its original root and cannot classify around it', async () => {
    const f = await baseInvoiceFixture()
    const invoice = baseInvoice(f, baseProrations(f))
    let announce!: (pid: number) => void
    let release!: () => void
    let expected: unknown
    const entered = new Promise<number>((resolve) => {
      announce = resolve
    })
    const proceed = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = tx(async (bound) => {
      await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
      await policy.registerSubscriptionInvoice(bound, {
        root: { type: 'organization', id: f.id },
        period: f.period,
        invoiceId: invoice.id as string,
        amountCents: '3500',
        currency: 'usd',
      })
      expected = await r10FinancialSnapshot(f, bound)
      const [session] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
      if (typeof session.pid !== 'number')
        throw new Error('Owned R10 original-root holder identity missing')
      announce(session.pid)
      await proceed
    })
    const blocker = await entered
    const credit = webhook(
      r10CreditForEvent({ ...invoice, total: -500 }, 'invoice.paid'),
      'invoice.paid'
    )
    try {
      await waitForBlockedSession(blocker)
    } finally {
      release()
      await holder
    }
    expect((await credit).status).toBe(400)
    expect(await r10FinancialSnapshot(f)).toEqual(expected)
    expect((await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent).toMatchObject({
      amountCents: '3500',
      invoiceObligationState: 'open',
    })
  })
  it('R10 historical credit with no original preserved basis refuses without initializing one', async () => {
    const f = await baseInvoiceFixture()
    const before = await r10FinancialSnapshot(f)
    const interval = {
      start: Date.parse('2025-12-01T00:00:00Z') / 1000,
      end: Date.parse(f.period.start!) / 1000,
    }
    const credit = baseInvoice(
      f,
      [baseInvoiceLine(f, false, 'subscription_item_details', interval)],
      { total: -500 }
    )
    const response = await webhook(credit, 'invoice.finalized')
    expect(response.status).toBe(400)
    expect(await r10FinancialSnapshot(f)).toEqual(before)
    expect(await policy.readSubscriptionInvoice(db, credit.id as string)).toBeNull()
  })
  for (const total of [0, 3500]) {
    it(`R10 negative credit lines with nonnegative TOTAL ${total} remain exact canonical debit processing`, async () => {
      const f = await baseInvoiceFixture()
      const invoice = baseInvoice(
        f,
        baseProrations(f, 'invoice_item_details', undefined, undefined, total + 500),
        { total }
      )
      await acceptedWebhook(invoice, 'invoice.finalized')
      const beforePaid = await policy.readSubscriptionInvoice(db, invoice.id as string)
      expect(beforePaid?.intent).toMatchObject({
        subtype: 'subscription',
        amountCents: String(total),
        invoiceObligationState: 'open',
      })
      await acceptedWebhook({ ...invoice, status: 'paid', amount_paid: total }, 'invoice.paid')
      expect(
        (await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent
      ).toMatchObject({ amountCents: String(total), invoiceObligationState: 'closed' })
    })
  }
  it('R10 recurring credit cannot use a retained credited invoice from another original owner', async () => {
    const f = await baseInvoiceFixture()
    const foreign = await baseInvoiceFixture()
    const foreignInvoice = baseInvoice(foreign, [baseInvoiceLine(foreign)])
    await acceptedWebhook(foreignInvoice, 'invoice.finalized')
    const before = [await r10FinancialSnapshot(f), await r10FinancialSnapshot(foreign)]
    const credit = baseInvoice(
      f,
      [
        baseInvoiceLine(f),
        {
          ...baseInvoiceLine(
            f,
            true,
            'invoice_item_details',
            undefined,
            foreignInvoice.id as string
          ),
          amount: -4500,
        },
      ],
      { total: -500 }
    )
    expect((await webhook(credit, 'invoice.finalized')).status).toBe(400)
    expect([await r10FinancialSnapshot(f), await r10FinancialSnapshot(foreign)]).toEqual(before)
    expect(await policy.readSubscriptionInvoice(db, credit.id as string)).toBeNull()
  })
  it('R10 an older credit requires its genuine credited-invoice closing basis after two rollovers and leaves all obligations unchanged', async () => {
    const f = await baseInvoiceFixture()
    await cost(f)
    const original = baseInvoice(f, [baseInvoiceLine(f)], { total: 4000 })
    await acceptedWebhook(original, 'invoice.finalized')
    await acceptedWebhook({ ...original, status: 'paid', amount_paid: 4000 }, 'invoice.paid')
    const { updateFinancialSubscription } = await import('./financial-subscriptions')
    for (const [start, end] of [
      ['2026-02-01', '2026-03-01'],
      ['2026-03-01', '2026-04-01'],
    ])
      await updateFinancialSubscription(f.subId, {
        periodStart: new Date(`${start}T00:00:00Z`),
        periodEnd: new Date(`${end}T00:00:00Z`),
      })
    const before = await r10FinancialSnapshot(f)
    const interval = {
      start: Date.parse('2026-01-15T00:00:00Z') / 1000,
      end: Date.parse(f.period.end!) / 1000,
    }
    const missing = baseInvoice(
      f,
      baseProrations(f, 'invoice_item_details', interval, undefined, 0),
      { total: -500 }
    )
    expect((await webhook(missing, 'invoice.finalized')).status).toBe(400)
    expect(await r10FinancialSnapshot(f)).toEqual(before)
    const credit = baseInvoice(
      f,
      baseProrations(f, 'invoice_item_details', interval, original.id as string, 0),
      { total: -500 }
    )
    const result = await (await import('./webhooks/invoices')).handleInvoiceFinalized(
      signedBaseInvoice(credit, 'invoice.finalized')
    )
    expect(result).toMatchObject({
      kind: 'verified-provider-credit',
      period: f.period,
      signedTotalCents: '-500',
      creditedInvoiceIds: [original.id],
    })
    for (const type of r10CreditTypes) {
      await acceptedWebhook(r10CreditForEvent(credit, type), type)
      expect(await r10FinancialSnapshot(f)).toEqual(before)
      expect(await policy.readSubscriptionInvoice(db, credit.id as string)).toBeNull()
    }
    expect((await policy.readSubscriptionInvoice(db, original.id as string))?.intent).toMatchObject(
      { amountCents: '4000', invoiceObligationState: 'closed' }
    )
  })
  for (const variant of ['currency', 'customer', 'incomplete-lines'] as const) {
    it(`R10 negative TOTAL never authorizes invalid original ${variant} scope`, async () => {
      const f = await baseInvoiceFixture()
      const before = await r10FinancialSnapshot(f)
      const credit = baseInvoice(f, baseProrations(f), {
        total: -500,
        ...(variant === 'currency'
          ? { currency: 'eur' }
          : variant === 'customer'
            ? { customer: 'cus_foreign' }
            : { lines: { data: baseProrations(f), has_more: true } }),
      })
      expect((await webhook(credit, 'invoice.finalized')).status).toBe(400)
      expect(await r10FinancialSnapshot(f)).toEqual(before)
    })
  }

  it('settles original organization out-of-band base debt through the configured signed paid route after replacement', async () => {
    const f = await baseInvoiceFixture()
    const binding = await cost(f)
    const invoice = baseInvoice(f, [baseInvoiceLine(f)])
    await acceptedWebhook(invoice, 'invoice.finalized')
    await acceptedWebhook(invoice, 'invoice.payment_failed')
    const original = await policy.readSubscriptionInvoice(db, invoice.id as string)
    await adapter.update({
      model: 'subscription',
      where: [{ field: 'id', value: f.subId }],
      update: { status: 'canceled' },
    })
    const { createFinancialSubscription } = await import('./financial-subscriptions')
    await createFinancialSubscription({
      id: randomUUID(),
      plan: f.originalTier.id,
      billingTierId: f.originalTier.id,
      referenceType: 'organization',
      referenceId: f.id,
      status: 'active',
      seats: 1,
      stripeCustomerId: `${f.tag}-replacement-customer`,
      stripeSubscriptionId: `${f.tag}-replacement-subscription`,
      periodStart: new Date('2026-02-01T00:00:00Z'),
      periodEnd: new Date('2026-03-01T00:00:00Z'),
    })
    const money = await baseInvoiceMoney(f, binding)
    await acceptedWebhook(paidInvoice(invoice), 'invoice.paid')
    const paid = await policy.readSubscriptionInvoice(db, invoice.id as string)
    expect(paid?.intent).toMatchObject({
      fingerprint: original!.intent.fingerprint,
      root: original!.intent.root,
      period: f.period,
      amountCents: '3500',
      invoiceObligationState: 'closed',
    })
    expect(await blockedBaseRoot(f)).toBe(false)
    expect(await baseInvoiceMoney(f, binding)).toEqual(money)
  })
  it('settles an original personal base invoice paid out of band without resetting its ledger', async () => {
    const tag = randomUUID()
    const owner = await person('r7-personal-invoice', `${tag}-cus`)
    await db.insert(tables.systemBillingTier).values({
      id: tag,
      displayName: 'Disposable paid personal invoice',
      description: 'Original paid user basis',
      status: 'active',
      ownerType: 'user',
      usageScope: 'individual',
      includedUsageLimitUsd: '20',
    })
    const { createFinancialSubscription } = await import('./financial-subscriptions')
    await createFinancialSubscription({
      id: `${tag}-sub`,
      plan: tag,
      billingTierId: tag,
      referenceType: 'user',
      referenceId: owner,
      status: 'active',
      stripeCustomerId: `${tag}-cus`,
      stripeSubscriptionId: `${tag}-stripe`,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-02-01T00:00:00Z'),
    })
    const period: policy.Period = {
      subscriptionId: `${tag}-sub`,
      stripeSubscriptionId: `${tag}-stripe`,
      customerId: `${tag}-cus`,
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-02-01T00:00:00.000Z',
    }
    const invoice = {
      id: `in_${tag}`,
      object: 'invoice',
      status: 'open',
      customer: period.customerId,
      currency: 'usd',
      total: 2500,
      amount_paid: 0,
      attempt_count: 1,
      metadata: {},
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: period.stripeSubscriptionId },
      },
      lines: {
        data: [
          {
            id: `line_${tag}`,
            period: {
              start: Date.parse(period.start!) / 1000,
              end: Date.parse(period.end!) / 1000,
            },
            parent: {
              type: 'subscription_item_details',
              subscription_item_details: {
                subscription: period.stripeSubscriptionId,
                proration: false,
              },
            },
          },
        ],
        has_more: false,
      },
    }
    await acceptedWebhook(invoice, 'invoice.payment_failed')
    const [before] = await db
      .select()
      .from(tables.userStats)
      .where(eq(tables.userStats.userId, owner))
    await acceptedWebhook(paidInvoice(invoice), 'invoice.paid')
    const [after] = await db
      .select()
      .from(tables.userStats)
      .where(eq(tables.userStats.userId, owner))
    expect(after.billingBlocked).toBe(false)
    const { billingBlocked: _a, ...beforeMoney } = before
    const { billingBlocked: _c, ...afterMoney } = after
    expect(afterMoney).toEqual(beforeMoney)
    expect((await policy.readSubscriptionInvoice(db, invoice.id))?.intent).toMatchObject({
      root: { type: 'user', id: owner },
      period,
      amountCents: '2500',
      invoiceObligationState: 'closed',
    })
  })
  it('settles an accepted original overage invoice paid out of band through configured signature verification', async () => {
    const { f, invoice, read } = await overageWebhookFixture()
    await acceptedWebhook(invoice, 'invoice.payment_failed')
    const before = await scopeSnapshot({ ...f, subId: f.period.subscriptionId! }, f.binding)
    await acceptedWebhook(paidInvoice(invoice), 'invoice.paid')
    expect(await read()).toMatchObject({
      invoiceId: invoice.id,
      period: f.period,
      fingerprint: f.intent.fingerprint,
      amountCents: f.intent.amountCents,
      invoiceObligationState: 'closed',
    })
    const after = await scopeSnapshot({ ...f, subId: f.period.subscriptionId! }, f.binding)
    const stripBlock = (value: typeof before) => {
      const { billingBlocked: _blocked, updatedAt: _updated, ...ledger } = value.organizationLedger
      return { ...value, organizationLedger: ledger }
    }
    expect(stripBlock(after)).toEqual(stripBlock(before))
  })
  for (const first of ['invoice.paid', 'invoice.payment_succeeded'] as const) {
    it(`converges configured ${first} first, both paid types and redelivery on each original base and overage invoice`, async () => {
      const f = await baseInvoiceFixture()
      await cost(f)
      const invoice = paidInvoice(baseInvoice(f, [baseInvoiceLine(f)]))
      const overage = await overageWebhookFixture()
      const second = first === 'invoice.paid' ? 'invoice.payment_succeeded' : 'invoice.paid'
      for (const current of [invoice, paidInvoice(overage.invoice)]) {
        await acceptedWebhook(current, first)
        const isBase = current === invoice
        const read = () =>
          isBase
            ? policy.readSubscriptionInvoice(db, current.id as string).then((x) => x!.intent)
            : overage.read()
        const original = await read()
        const money = isBase
          ? await baseInvoiceMoney(f)
          : await db
              .select()
              .from(tables.organizationBillingLedger)
              .where(eq(tables.organizationBillingLedger.organizationId, overage.f.id))
        await acceptedWebhook(current, second)
        await acceptedWebhook(current, first)
        expect(await read()).toEqual(original)
        expect(
          isBase
            ? await baseInvoiceMoney(f)
            : await db
                .select()
                .from(tables.organizationBillingLedger)
                .where(eq(tables.organizationBillingLedger.organizationId, overage.f.id))
        ).toEqual(money)
        expect(original).toMatchObject({ invoiceObligationState: 'closed' })
      }
    })
  }
  it('retains other open debt, one failure marker and an uncertain hold through configured failure, paid and stale failures', async () => {
    const f = await baseInvoiceFixture()
    await cost(f)
    const binding = await scopeBinding(f)
    await tx((bound) => policy.admitModelStep(bound, binding, firstScopeOccurrence, true))
    const a = baseInvoice(f, [baseInvoiceLine(f)])
    const b = baseInvoice(f, [baseInvoiceLine(f)], { total: 4200 })
    await acceptedWebhook(a, 'invoice.payment_failed')
    await acceptedWebhook(a, 'invoice.payment_failed')
    await acceptedWebhook(b, 'invoice.payment_failed')
    const original = await policy.readSubscriptionInvoice(db, a.id as string)
    expect(
      original?.intent.markers.filter((marker) => marker.kind === 'notification')
    ).toHaveLength(1)
    const money = await baseInvoiceMoney(f, binding)
    await acceptedWebhook(paidInvoice(a), 'invoice.paid')
    const closed = await policy.readSubscriptionInvoice(db, a.id as string)
    await acceptedWebhook(a, 'invoice.payment_failed')
    await acceptedWebhook(paidInvoice(a), 'invoice.payment_succeeded')
    expect(await policy.readSubscriptionInvoice(db, a.id as string)).toEqual(closed)
    expect(await blockedBaseRoot(f)).toBe(true)
    expect(
      (await policy.readSubscriptionInvoice(db, b.id as string))?.intent.invoiceObligationState
    ).toBe('open')
    await acceptedWebhook(paidInvoice(b), 'invoice.paid')
    expect(await blockedBaseRoot(f)).toBe(false)
    expect(await baseInvoiceMoney(f, binding)).toEqual(money)
    expect(money.first).toMatchObject({ contactState: 'uncertain', holdState: 'outstanding' })
  })
  for (const first of ['failure', 'payment'] as const) {
    it(`serializes configured signed failure and paid webhook with ${first} first on the original root`, async () => {
      const f = await baseInvoiceFixture()
      const invoice = baseInvoice(f, [baseInvoiceLine(f)])
      await acceptedWebhook(invoice, 'invoice.finalized')
      const money = await baseInvoiceMoney(f)
      let announce!: (pid: number) => void
      let release!: () => void
      const locked = new Promise<number>((yes) => {
        announce = yes
      })
      const gate = new Promise<void>((yes) => {
        release = yes
      })
      const holder = tx(async (bound) => {
        await policy.lockFinancialRoots(bound, [{ type: 'organization', id: f.id }])
        const [row] = await bound.execute(sql`SELECT pg_backend_pid() AS pid`)
        announce(Number(row.pid))
        await gate
      })
      const blocker = await locked
      const failed = () => acceptedWebhook(invoice, 'invoice.payment_failed')
      const paid = () => acceptedWebhook(paidInvoice(invoice), 'invoice.paid')
      const earlier = Promise.allSettled([first === 'failure' ? failed() : paid()])
      let later: Promise<PromiseSettledResult<void>[]> | undefined
      try {
        const waiting = await waitForBlockedSession(blocker)
        later = Promise.allSettled([first === 'failure' ? paid() : failed()])
        await waitForBlockedSession(waiting)
      } finally {
        release()
        await Promise.allSettled([holder, earlier, ...(later ? [later] : [])])
      }
      expect((await earlier)[0].status).toBe('fulfilled')
      expect(later && (await later)[0].status).toBe('fulfilled')
      expect(
        (await policy.readSubscriptionInvoice(db, invoice.id as string))?.intent
      ).toMatchObject({
        invoiceObligationState: 'closed',
        period: f.period,
        amountCents: '3500',
      })
      expect(await blockedBaseRoot(f)).toBe(false)
      expect(await baseInvoiceMoney(f)).toEqual(money)
    })
  }
  it('refuses configured invalid signatures, non-paid status and changed original identity without financial writes', async () => {
    const f = await baseInvoiceFixture()
    const invoice = baseInvoice(f, [baseInvoiceLine(f)])
    await acceptedWebhook(invoice, 'invoice.finalized')
    const before = await policy.readSubscriptionInvoice(db, invoice.id as string)
    const money = await baseInvoiceMoney(f)
    for (const [object, signature] of [
      [paidInvoice(invoice), 't=0,v1=not-a-signature'],
      [invoice, undefined],
      [paidInvoice({ ...invoice, customer: 'changed-original-customer' }), undefined],
      [paidInvoice({ ...invoice, total: 3501 }), undefined],
      [paidInvoice({ ...invoice, currency: 'eur' }), undefined],
      [
        paidInvoice({
          ...invoice,
          parent: {
            type: 'subscription_details',
            subscription_details: { subscription: 'changed-original-subscription' },
          },
        }),
        undefined,
      ],
      [
        paidInvoice({
          ...invoice,
          lines: {
            data: [baseInvoiceLine(f, false, 'subscription_item_details', { start: 1, end: 2 })],
            has_more: false,
          },
        }),
        undefined,
      ],
    ] as Array<[Record<string, unknown>, string | undefined]>) {
      const response = await webhook(object, 'invoice.paid', signature)
      expect(response.status).toBe(400)
      expect(await policy.readSubscriptionInvoice(db, invoice.id as string)).toEqual(before)
      expect(await baseInvoiceMoney(f)).toEqual(money)
    }
  })
  it('routes actual Vision URL scope to the original organization payer and refuses denied or conflicting targets before fake inference', async () => {
    const f = await organizationFixture()
    const workflowId = `${f.tag}-r7-vision-workflow`
    const at = new Date()
    await db.insert(tables.workflow).values({
      id: workflowId,
      userId: f.owner,
      workspaceId: f.workspaceId,
      name: 'Disposable Vision financial scope',
      createdAt: at,
      updatedAt: at,
      lastSynced: at,
    })
    let modelCalls = 0
    state.visionModel = new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        modelCalls++
        return {
          content: [{ type: 'text', text: 'Synthetic image description' }],
          finishReason: 'stop',
          usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
          warnings: [],
        }
      },
    })
    state.visionAuth = { success: true, userId: f.owner, authType: 'internal' }
    const [personalBefore] = await db
      .select()
      .from(tables.userStats)
      .where(eq(tables.userStats.userId, f.owner))
    const { POST } = await import('@/app/api/tools/vision/analyze/route')
    const request = (workflow = workflowId, workspace = f.workspaceId) =>
      new NextRequest(
        `http://127.0.0.1/api/tools/vision/analyze?workflowId=${encodeURIComponent(workflow)}&workspaceId=${encodeURIComponent(workspace)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'openai/gpt-4o',
            imageUrl: 'data:image/png;base64,c3ludGhldGlj',
          }),
        }
      )
    try {
      const response = await POST(request())
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        success: true,
        output: {
          content: 'Synthetic image description',
          tokens: 3,
          cost: { status: 'unavailable' },
        },
      })
      expect(modelCalls).toBe(1)
      const rows = await db
        .select()
        .from(tables.idempotencyKey)
        .where(
          and(
            eq(tables.idempotencyKey.namespace, ns(f.id)),
            sql`${tables.idempotencyKey.result}->>'recordType' = 'invocation'`,
            sql`${tables.idempotencyKey.result}->'identity'->>'purpose' = 'vision'`
          )
        )
      expect(rows).toHaveLength(1)
      const invocation = rows[0].result as policy.FinancialReceipt
      if (invocation.recordType !== 'invocation')
        throw new Error('Actual Vision invocation required')
      expect(invocation.identity).toMatchObject({
        root: { type: 'organization', id: f.id },
        memberUserId: f.owner,
        actorUserId: f.owner,
        workspaceId: f.workspaceId,
        workflowId,
        purpose: 'vision',
      })
      expect(
        await tx((bound) =>
          policy.verifyAcceptance(bound, invocation.binding, { stepNumber: 0, retryCount: 0 })
        )
      ).toMatchObject({ accepted: true, appliedUsd: '0', modelUsd: 'unavailable' })
      expect(
        asJson(
          (await db.select().from(tables.userStats).where(eq(tables.userStats.userId, f.owner)))[0]
        )
      ).toEqual(asJson(personalBefore))
      const outsider = await person('r7-vision-nonmember')
      await db.insert(tables.permissions).values({
        id: randomUUID(),
        entityType: 'workspace',
        entityId: f.workspaceId,
        userId: outsider,
        permissionType: 'admin',
      })
      state.visionAuth = { success: true, userId: outsider, authType: 'internal' }
      expect((await POST(request())).status).toBe(403)
      state.visionAuth = { success: true, userId: f.owner, authType: 'internal' }
      const foreign = await organizationFixture()
      expect((await POST(request(workflowId, foreign.workspaceId))).status).toBe(403)
      state.visionAuth = {
        success: true,
        userId: f.owner,
        workspaceId: f.workspaceId,
        authType: 'api_key',
      }
      expect((await POST(request(workflowId, foreign.workspaceId))).status).toBe(403)
      expect(modelCalls).toBe(1)
      expect(
        await db
          .select()
          .from(tables.idempotencyKey)
          .where(
            and(
              eq(tables.idempotencyKey.namespace, ns(f.id)),
              sql`${tables.idempotencyKey.result}->>'recordType' = 'invocation'`,
              sql`${tables.idempotencyKey.result}->'identity'->>'purpose' = 'vision'`
            )
          )
      ).toHaveLength(1)
    } finally {
      state.visionAuth = null
      state.visionModel = null
    }
  })
  // R8 keeps real source/claim/contact SQL; renderer and provider HTTP are explicitly local seams.
  async function r8MailEnvironment() {
    const services = await import('@/lib/system-services/runtime')
    const emailUtils = await import('@/lib/email/utils')
    const unsubscribe = await import('@/lib/email/unsubscribe')
    const resend = vi
      .spyOn(services, 'resolveResendServiceConfig')
      .mockResolvedValue({ apiKey: 're_synthetic_source_only', audienceId: null })
    const sender = vi
      .spyOn(emailUtils, 'getFromEmailAddress')
      .mockResolvedValue('TradingGoose <billing@fixture.invalid>')
    const opted = vi.spyOn(unsubscribe, 'isUnsubscribed').mockResolvedValue(false)
    const token = vi
      .spyOn(unsubscribe, 'generateUnsubscribeToken')
      .mockReturnValue('synthetic-source-token')
    const previous = globalThis.fetch
    const calls: Array<{ method: string; body: string; key: string | null }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof Request ? input.url : input.href
        )
        if (
          url.origin !== 'https://api.resend.com' ||
          url.pathname !== '/emails' ||
          init?.method !== 'POST'
        )
          throw new Error('Unexpected synthetic financial provider request')
        calls.push({
          method: init.method,
          body: String(init.body),
          key: new Headers(init.headers).get('idempotency-key'),
        })
        return Response.json({ id: randomUUID() })
      })
    )
    return {
      calls,
      close: () => {
        globalThis.fetch = previous
        resend.mockRestore()
        sender.mockRestore()
        opted.mockRestore()
        token.mockRestore()
        state.deliveryRender = null
      },
    }
  }
  async function r8Notice(kind: 'pooled' | 'individual' | 'invoice') {
    if (kind === 'invoice') {
      const f = await baseInvoiceFixture()
      const invoice = baseInvoice(f, [baseInvoiceLine(f)])
      await (await baseInvoiceEvents(invoice)).failed()
      const source = await policy.readSubscriptionInvoice(db, invoice.id as string)
      if (!source) throw new Error('Original invoice source required')
      const notification = await tx((bound) =>
        policy.createFinancialNotification(bound, {
          namespace: source.namespace,
          sourceKey: source.key,
          recipientUserId: f.owner,
          notificationKind: 'payment-failed',
        })
      )
      const candidate = { ...notification, due: Date.now() }
      const claim = await tx((bound) => policy.claimFinancialDispatch(bound, candidate, Date.now()))
      if (!claim) throw new Error('Actual original notification claim required')
      return { f, recipient: f.owner, sourceKey: source.key, invoice, candidate, claim }
    }
    const f = await organizationFixture(3, kind)
    const recipient = await person(`r8-${kind}-recipient`)
    await adapter.create({
      model: 'member',
      data: {
        organizationId: f.id,
        userId: recipient,
        role: kind === 'pooled' ? 'admin' : 'member',
        createdAt: new Date(),
      },
    })
    if (kind === 'individual')
      await db.insert(tables.permissions).values({
        id: randomUUID(),
        userId: recipient,
        entityType: 'workspace',
        entityId: f.workspaceId,
        permissionType: 'admin',
      })
    const binding = await cost(
      f,
      kind === 'pooled' ? f.owner : recipient,
      kind === 'pooled' ? '49' : '17'
    )
    const sourceKey = policy.occurrenceKey(binding, firstScopeOccurrence)
    const facts = await tx((bound) =>
      policy.financialUsageNotificationFacts(bound, binding.namespace, sourceKey)
    )
    expect(facts?.warning).toBe(true)
    const notification = await tx((bound) =>
      policy.createFinancialNotification(bound, {
        namespace: binding.namespace,
        sourceKey,
        recipientUserId: recipient,
        notificationKind: 'usage-warning',
      })
    )
    const candidate = { ...notification, due: Date.now() }
    const claim = await tx((bound) => policy.claimFinancialDispatch(bound, candidate, Date.now()))
    if (!claim) throw new Error('Actual original notification claim required')
    return { f, recipient, sourceKey, invoice: undefined, candidate, claim }
  }
  async function r8NoticeMoney(id: string) {
    return asJson({
      root: await db
        .select()
        .from(tables.organizationBillingLedger)
        .where(eq(tables.organizationBillingLedger.organizationId, id)),
      members: await db
        .select()
        .from(tables.organizationMemberBillingLedger)
        .where(eq(tables.organizationMemberBillingLedger.organizationId, id))
        .orderBy(tables.organizationMemberBillingLedger.userId),
    })
  }
  for (const change of [
    'admin-demotion',
    'membership-removal',
    'email',
    'preferences',
    'invoice-paid',
    'closing',
    'suspension',
    'rollover',
    'threshold',
  ] as const) {
    it(`R8 final first-contact gate observes committed ${change} during render and suppresses only genuinely unsent mail`, async () => {
      const target = await r8Notice(change === 'invoice-paid' ? 'invoice' : 'pooled')
      const mail = await r8MailEnvironment()
      const { executeFinancialNotification } = await import('./financial-notifications')
      let entered!: () => void
      let release!: () => void
      const rendered = new Promise<void>((yes) => {
        entered = yes
      })
      const gate = new Promise<void>((yes) => {
        release = yes
      })
      state.deliveryRender = async () => {
        entered()
        await gate
        return '<p>Original synthetic financial notice</p>'
      }
      const work = executeFinancialNotification(target.claim, Date.now() + 20000)
      let originalThreshold: number | undefined
      try {
        await Promise.race([
          rendered,
          work.then(() => {
            throw new Error('Expected render barrier')
          }),
        ])
        const { mutateOrganizationFinancialScope } = await import('./financial-membership')
        if (change === 'admin-demotion' || change === 'membership-removal') {
          await mutateOrganizationFinancialScope(
            target.f.id,
            async (bound) => {
              const where = and(
                eq(tables.member.organizationId, target.f.id),
                eq(tables.member.userId, target.recipient)
              )
              if (change === 'membership-removal') await bound.delete(tables.member).where(where)
              else await bound.update(tables.member).set({ role: 'member' }).where(where)
            },
            {
              actorUserId: target.f.owner,
              targetUserId: target.recipient,
              ...(change === 'admin-demotion' ? { requestedRole: 'member' } : {}),
            }
          )
        } else if (change === 'email' || change === 'preferences') {
          await tx(async (bound) => {
            await policy.lockFinancialRoots(bound, [target.claim.root])
            if (change === 'email')
              await bound
                .update(tables.user)
                .set({ email: `${randomUUID()}@invalid.test` })
                .where(eq(tables.user.id, target.recipient))
            else
              await bound
                .insert(tables.settings)
                .values({
                  id: target.recipient,
                  userId: target.recipient,
                  billingUsageNotificationsEnabled: false,
                  emailPreferences: { unsubscribeAll: true },
                })
                .onConflictDoUpdate({
                  target: tables.settings.userId,
                  set: {
                    billingUsageNotificationsEnabled: false,
                    emailPreferences: { unsubscribeAll: true },
                  },
                })
          })
        } else if (change === 'invoice-paid') {
          if (!target.invoice) throw new Error('Original invoice required')
          await (await baseInvoiceEvents(target.invoice)).paid()
        } else if (change === 'threshold') {
          const [before] = await db
            .select()
            .from(tables.systemBillingSettings)
            .where(eq(tables.systemBillingSettings.id, 'global'))
          originalThreshold = before.usageWarningThresholdPercent
          await tx(async (bound) => {
            await bound.execute(sql`SELECT pg_advisory_xact_lock(${policy.CATALOG_LOCK}::bigint)`)
            await bound
              .update(tables.systemBillingSettings)
              .set({ usageWarningThresholdPercent: 99 })
              .where(eq(tables.systemBillingSettings.id, 'global'))
          })
        } else {
          const source = await policy.readFinancialReceipt(
            db,
            target.candidate.namespace,
            target.sourceKey
          )
          if (!source || source.recordType !== 'operation' || !source.identity.period)
            throw new Error('Original operation period required')
          if (change === 'closing')
            await tx((bound) =>
              policy.closeFinancialPeriod(bound, target.claim.root, source.identity.period!)
            )
          else {
            const { updateFinancialSubscription } = await import('./financial-subscriptions')
            await updateFinancialSubscription(
              source.identity.period.subscriptionId,
              change === 'suspension'
                ? { status: 'unpaid' }
                : {
                    periodStart: new Date('2026-02-01T00:00:00Z'),
                    periodEnd: new Date('2026-03-01T00:00:00Z'),
                  }
            )
          }
        }
        const money = await r8NoticeMoney(target.f.id)
        release()
        await expect(work).resolves.toEqual({ outcome: 'complete' })
        expect(mail.calls).toHaveLength(0)
        const retained = await policy.readFinancialReceipt(
          db,
          target.candidate.namespace,
          target.candidate.key
        )
        expect(retained && 'markers' in retained && retained.markers[0].state).toBe('suppressed')
        expect(
          retained && 'markers' in retained && retained.markers[0].firstContactAtMs
        ).toBeUndefined()
        expect(await r8NoticeMoney(target.f.id)).toEqual(money)
      } finally {
        release()
        await Promise.allSettled([work])
        if (originalThreshold !== undefined)
          await tx(async (bound) => {
            await bound.execute(sql`SELECT pg_advisory_xact_lock(${policy.CATALOG_LOCK}::bigint)`)
            await bound
              .update(tables.systemBillingSettings)
              .set({ usageWarningThresholdPercent: originalThreshold })
              .where(eq(tables.systemBillingSettings.id, 'global'))
          })
        mail.close()
      }
    })
  }
  for (const scope of ['pooled', 'individual'] as const) {
    it(`R8 current eligible ${scope} recipient reaches real contact preparation and installed synthetic Resend transport once`, async () => {
      const target = await r8Notice(scope)
      const mail = await r8MailEnvironment()
      state.deliveryRender = async () => '<p>Exact original notice</p>'
      try {
        const before = await r8NoticeMoney(target.f.id)
        expect(
          (
            await (
              await import('./financial-notifications')
            ).executeFinancialNotification(target.claim, Date.now() + 20000)
          ).outcome
        ).toBe('complete')
        expect(mail.calls).toHaveLength(1)
        const receipt = await policy.readFinancialReceipt(
          db,
          target.candidate.namespace,
          target.candidate.key
        )
        if (!receipt || receipt.recordType !== 'notification')
          throw new Error('Actual notification required')
        expect(receipt.markers[0]).toMatchObject({
          state: 'complete',
          provider: 'resend',
          requestKey: `financial-email:${receipt.fingerprint}`,
        })
        const email = await import('@/lib/email/financial-email')
        const envelope = email.parseFrozenFinancialEmail(receipt.markers[0].payload?.envelope)
        expect(mail.calls[0].body).toBe(envelope.requestJson)
        expect(mail.calls[0].key).toBe(receipt.markers[0].requestKey)
        expect(await r8NoticeMoney(target.f.id)).toEqual(before)
      } finally {
        mail.close()
      }
    })
  }
  it('R8 a reclaimed real claim during render prevents stale preparation or any transport', async () => {
    const target = await r8Notice('pooled')
    const mail = await r8MailEnvironment()
    let entered!: () => void
    let release!: () => void
    const rendered = new Promise<void>((yes) => {
      entered = yes
    })
    const gate = new Promise<void>((yes) => {
      release = yes
    })
    state.deliveryRender = async () => {
      entered()
      await gate
      return '<p>Original</p>'
    }
    const work = (await import('./financial-notifications')).executeFinancialNotification(
      target.claim,
      Date.now() + 20000
    )
    try {
      await Promise.race([
        rendered,
        work.then(() => {
          throw new Error('Expected render barrier')
        }),
      ])
      const next = await tx((bound) =>
        policy.claimFinancialDispatch(
          bound,
          target.candidate,
          target.claim.marker.claimExpiresAtMs! + 1
        )
      )
      if (!next) throw new Error('Actual reclaimed notification required')
      expect(next.marker.claimId).not.toBe(target.claim.marker.claimId)
      release()
      await expect(work).rejects.toThrow('claim was lost')
      expect(mail.calls).toHaveLength(0)
      const receipt = await policy.readFinancialReceipt(
        db,
        target.candidate.namespace,
        target.candidate.key
      )
      expect(receipt && 'markers' in receipt && receipt.markers[0].claimId).toBe(
        next.marker.claimId
      )
      expect(receipt && 'markers' in receipt && receipt.markers[0].firstContactAtMs).toBeUndefined()
    } finally {
      release()
      await Promise.allSettled([work])
      mail.close()
    }
  })
  it('R8 prepared recovery preserves original frozen bytes and first-contact identity after eligibility loss', async () => {
    const target = await r8Notice('pooled')
    const notification = target.claim.receipt
    if (notification.recordType !== 'notification')
      throw new Error('Original notification required')
    const mail = await r8MailEnvironment()
    const email = await import('@/lib/email/financial-email')
    const [recipient] = await db
      .select()
      .from(tables.user)
      .where(eq(tables.user.id, target.recipient))
    try {
      const prepared = await email.prepareFinancialEmail({
        to: recipient.email,
        subject: 'Original frozen subject',
        html: '<p>Original frozen bytes</p>',
        emailType: 'notifications',
        locale: 'en',
      })
      if (prepared.status !== 'ready')
        throw new Error('Actual prepared financial envelope required')
      const first = Date.now()
      await tx((bound) =>
        policy.prepareFinancialContact(bound, target.claim, {
          provider: prepared.envelope.provider,
          requestKey: `financial-email:${notification.fingerprint}`,
          fingerprint: prepared.envelope.fingerprint,
          now: first,
          payload: { envelope: prepared.envelope, azureOperationId: randomUUID() },
        })
      )
      const { mutateOrganizationFinancialScope } = await import('./financial-membership')
      await mutateOrganizationFinancialScope(
        target.f.id,
        async (bound) => {
          await bound
            .update(tables.member)
            .set({ role: 'member' })
            .where(
              and(
                eq(tables.member.organizationId, target.f.id),
                eq(tables.member.userId, target.recipient)
              )
            )
        },
        { actorUserId: target.f.owner, targetUserId: target.recipient, requestedRole: 'member' }
      )
      const reclaimed = await tx((bound) =>
        policy.claimFinancialDispatch(
          bound,
          target.candidate,
          target.claim.marker.claimExpiresAtMs! + 1
        )
      )
      if (!reclaimed) throw new Error('Actual prepared recovery claim required')
      expect(reclaimed.reconcile).toBe(true)
      state.deliveryRender = async () => {
        throw new Error('Prepared recovery must never render again')
      }
      await (await import('./financial-notifications')).executeFinancialNotification(
        reclaimed,
        Date.now() + 20000
      )
      expect(mail.calls).toHaveLength(1)
      expect(mail.calls[0].body).toBe(prepared.envelope.requestJson)
      expect(mail.calls[0].key).toBe(`financial-email:${notification.fingerprint}`)
      const receipt = await policy.readFinancialReceipt(
        db,
        target.candidate.namespace,
        target.candidate.key
      )
      expect(receipt && 'markers' in receipt && receipt.markers[0].firstContactAtMs).toBe(first)
    } finally {
      mail.close()
    }
  })
  it('R8 personal usage notification retains its original user recipient through actual claim and transport', async () => {
    const owner = await person('r8-personal-notice', undefined, '0.3')
    const tier = randomUUID()
    await db.insert(tables.systemBillingTier).values({
      id: tier,
      displayName: 'Disposable personal notice',
      description: 'Synthetic original grant source',
      status: 'active',
      ownerType: 'user',
      usageScope: 'individual',
      isDefault: true,
      includedUsageLimitUsd: '0',
    })
    const { createFinancialSubscription } = await import('./financial-subscriptions')
    await createFinancialSubscription({
      id: `${tier}-sub`,
      plan: tier,
      billingTierId: tier,
      referenceType: 'user',
      referenceId: owner,
      status: 'active',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      periodStart: null,
      periodEnd: null,
    })
    const binding = await tx((bound) =>
      policy.createInvocation(bound, {
        actorUserId: owner,
        runId: randomUUID(),
        operationKey: randomUUID(),
        purpose: 'copilot',
        quotedHoldUsd: '0.05',
        schedulerReady: true,
      })
    )
    await tx((bound) => policy.admitModelStep(bound, binding, firstScopeOccurrence, true))
    await acceptScopeAmount(binding, firstScopeOccurrence, '0.25')
    const sourceKey = policy.occurrenceKey(binding, firstScopeOccurrence)
    expect(
      (
        await tx((bound) =>
          policy.financialUsageNotificationFacts(bound, binding.namespace, sourceKey)
        )
      )?.warning
    ).toBe(true)
    const notice = await tx((bound) =>
      policy.createFinancialNotification(bound, {
        namespace: binding.namespace,
        sourceKey,
        recipientUserId: owner,
        notificationKind: 'usage-warning',
      })
    )
    const claim = await tx((bound) =>
      policy.claimFinancialDispatch(bound, { ...notice, due: Date.now() }, Date.now())
    )
    if (!claim) throw new Error('Actual personal notification claim required')
    const mail = await r8MailEnvironment()
    state.deliveryRender = async () => '<p>Original personal financial notice</p>'
    try {
      const [before] = await db
        .select()
        .from(tables.userStats)
        .where(eq(tables.userStats.userId, owner))
      await (await import('./financial-notifications')).executeFinancialNotification(
        claim,
        Date.now() + 20000
      )
      expect(mail.calls).toHaveLength(1)
      const receipt = await policy.readFinancialReceipt(db, notice.namespace, notice.key)
      expect(receipt).toMatchObject({
        recordType: 'notification',
        root: { type: 'user', id: owner },
        recipientUserId: owner,
        dispatchState: 'complete',
      })
      expect(
        asJson(
          (await db.select().from(tables.userStats).where(eq(tables.userStats.userId, owner)))[0]
        )
      ).toEqual(asJson(before))
    } finally {
      mail.close()
    }
  })
  it('R8 unprovable original owner, money and unreadable marker collections remain unchanged overdue blockers', async () => {
    // Prepare all genuine original data first; no admission follows the deliberate unprovable corruptions.
    const originals = await Promise.all([
      r8OriginalInvoice(),
      r8OriginalInvoice(),
      r8OriginalInvoice(),
    ])
    const targets: Array<{ candidate: policy.DispatchCandidate; raw: Record<string, unknown> }> = []
    for (let i = 0; i < originals.length; i++) {
      const original = originals[i]
      const candidate = {
        namespace: original.bound.namespace,
        key: original.bound.key,
        due: Date.now() - 400001,
      }
      const raw = structuredClone(original.bound.intent) as unknown as Record<string, unknown>
      Object.assign(raw, { dispatchState: 'pending', dispatchAtMs: candidate.due, markers: [] })
      if (i === 0) raw.root = { type: 'organization', id: 'unproven-other-original-owner' }
      if (i === 1) raw.amountCents = '01'
      if (i === 2) raw.markers = [null]
      await r8Write(candidate, raw)
      targets.push({ candidate, raw })
    }
    const service = await r8DefaultExecute()
    const result = await policy.drainFinancialDispatch(db, { execute: service })
    expect(result.integrityUnresolved).toBeGreaterThanOrEqual(3)
    for (const target of targets) expect(await r8Raw(target.candidate)).toEqual(target.raw)
    expect((await policy.probeFinancialBackpressure(db)).blocked).toBe(true)
  })
})
