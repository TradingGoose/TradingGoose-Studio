import { readFileSync } from 'node:fs'
import * as tables from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import * as ts from 'typescript'
import { describe, expect, it } from 'bun:test'
import {
  acceptInvoicePayment,
  acceptModelStep,
  admitModelStep,
  claimFinancialDispatch,
  classifyFinancialDispatch,
  type DispatchClaim,
  drainFinancialDispatch,
  evaluateFinancialPeriod,
  type FinancialBinding,
  type FinancialDatabase,
  FinancialDispatchIntegrityError,
  type FinancialIdentity,
  type FinancialReceipt,
  type FinancialTransaction,
  financialFingerprint,
  financialNamespace,
  type InvoiceReceipt,
  type MemberRegistrationReceipt,
  type MemberRegistryReceipt,
  type OperationReceipt,
  occurrenceKey,
  type Period,
  type PeriodReceipt,
  periodKey,
  prepareFinancialContact,
  resumeFinancialPeriodEligibility,
  suspendFinancialPeriodEligibility,
  writeFinancialReceipt,
} from './index'

// Readiness is a narrow mocked boundary here; actual canonical PG catalogs are checked by
// the disposable-storage suite. Derive its literal rows from owned source, not a second index catalogue.
const program = ts.createSourceFile(
  'storage.ts',
  readFileSync(new URL('./storage.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
function literal(node: ts.Node): unknown {
  if (ts.isAsExpression(node)) return literal(node.expression)
  if (ts.isStringLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property))
          throw new Error('Unsupported catalogue fixture literal')
        const name = property.name.getText(program).replace(/^['"]|['"]$/g, '')
        return [name, literal(property.initializer)]
      })
    )
  throw new Error('Unsupported catalogue fixture literal')
}
let catalogue: unknown
for (const statement of program.statements)
  if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations)
      if (declaration.name.getText(program) === 'expectedIndexes' && declaration.initializer)
        catalogue = literal(declaration.initializer)
if (!catalogue || typeof catalogue !== 'object')
  throw new Error('Canonical catalogue fixture absent')
const indexRows = Object.entries(catalogue).map(([name, value]) => ({
  name,
  ...(value as object),
  valid: true,
}))
const root = { type: 'organization' as const, id: 'unit-original-organization' }
const namespace = financialNamespace(root)
const actor = 'unit-original-member'
const originalPeriod: Period = {
  subscriptionId: 'unit-subscription',
  stripeSubscriptionId: 'sub_unit',
  customerId: 'cus_unit',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-02-01T00:00:00.000Z',
}
const at = '2026-11-09T00:00:00.000Z'
const clone = <T>(value: T): T => structuredClone(value)
function fixture(
  options: {
    frozen?: boolean
    policy?: boolean
    slot?: 'current' | 'previous' | 'older'
    duplicate?: boolean
    member?: boolean
    admit?: boolean
    currentMember?: boolean
    billingEnabled?: boolean
    suspended?: boolean
  } = {}
) {
  const identity: FinancialIdentity = {
    root,
    actorUserId: actor,
    memberUserId: options.member ? actor : null,
    scope: options.member ? 'organization_member' : 'organization',
    period: options.billingEnabled === false ? null : originalPeriod,
    billingEnabled: options.billingEnabled ?? true,
    quote: {
      holdUsd: '1',
      multiplier: '1',
      modelUsd: 'unavailable',
      baseChargeUsd: '0',
      defaultGrant: false,
      billable: true,
    },
    workspaceId: options.admit ? 'unit-original-workspace' : null,
    workflowId: null,
    purpose: 'copilot',
  }
  const binding: FinancialBinding = {
    namespace,
    key: 'invocation:unit-run',
    fingerprint: financialFingerprint({ identity, runId: 'unit-run' }),
    runId: 'unit-run',
    actorUserId: actor,
    workspaceId: identity.workspaceId,
    workflowId: null,
    purpose: 'copilot',
  }
  const occurrence = { stepNumber: 0, retryCount: 0 }
  const key = occurrenceKey(binding, occurrence)
  const invocation: FinancialReceipt = {
    recordType: 'invocation',
    identity,
    binding,
    fingerprint: binding.fingerprint,
    financialClosureState: 'closed',
  }
  const operation: OperationReceipt = {
    recordType: 'operation',
    identity,
    binding,
    fingerprint: financialFingerprint([binding.fingerprint, key]),
    financialClosureState: 'open',
    holdState: 'outstanding',
    contactState: 'uncertain',
    modelUsd: 'unavailable',
    dispatchState: 'complete',
    dispatchAtMs: 0,
    markers: [],
  }
  const registry: MemberRegistryReceipt = {
    recordType: 'member-registry',
    version: 1,
    root,
    financialClosureState: 'closed',
    provenance: {
      kind: 'live-root-creation',
      reference: `organization:${root.id}`,
      digest: financialFingerprint({ root, creation: 'actual-organization-insert', baseline: [] }),
      observedAt: at,
    },
  }
  const anchor = financialFingerprint({ organizationId: root.id, userId: actor })
  const pair: MemberRegistrationReceipt = {
    recordType: 'member-registration',
    version: 1,
    root,
    userId: actor,
    ledgerAnchor: anchor,
    financialClosureState: 'closed',
    provenance: {
      kind: 'live-membership-registration',
      reference: 'member:unit-member-id',
      digest: financialFingerprint({
        root,
        userId: actor,
        ledgerAnchor: anchor,
        actualMembershipId: 'unit-member-id',
      }),
      observedAt: at,
    },
  }
  const newer = { ...originalPeriod, subscriptionId: 'unit-later-subscription' }
  const head: FinancialReceipt = {
    recordType: 'period-head',
    root,
    financialClosureState: 'open',
    current: options.slot && options.slot !== 'current' ? newer : originalPeriod,
    previous: options.slot === 'previous' ? originalPeriod : null,
  }
  const basis: PeriodReceipt = {
    recordType: 'period',
    root,
    period: originalPeriod,
    financialClosureState: 'open',
    commitments: { issuedUsd: '0', pendingUsd: '0' },
    closing: options.frozen
      ? {
          acceptedUsd: '1',
          copilotUsd: '1',
          memberUsd: options.member ? { [actor]: '1' } : {},
          allowanceUsd: '20',
          mode: options.member ? 'individual' : 'pooled',
          frozenAt: at,
        }
      : null,
    invoicePrefix: 'invoice:unit',
    dispatchState: 'complete',
    dispatchAtMs: 0,
    markers: [],
  }
  if (options.suspended)
    basis.suspension = {
      allowanceUsd: '20',
      mode: options.member ? 'individual' : 'pooled',
      defaultGrant: false,
      capturedAt: at,
    }
  const writes: { key: string; result: FinancialReceipt }[] = []
  const updates: { table: unknown; values: Record<string, unknown> }[] = []
  const queried: unknown[] = []
  const holds: { key: string; result: OperationReceipt }[] = []
  const originalInvocations = new Map<string, FinancialReceipt>()
  const originalBatches: unknown[][] = []
  const retainedMembers = new Set([actor])
  const historicalMemberReads: string[] = []
  const locked: unknown[] = []
  const memberAuthorizationLocks: unknown[][] = []
  const ledger = {
    totalCost: '1',
    currentPeriodCost: '1',
    lastPeriodCost: '0',
    currentPeriodCopilotCost: '1',
    billedOverage: '0',
    blocked: false,
  }
  const receipts: (FinancialReceipt | null | (() => FinancialReceipt))[] = [
    invocation,
    operation,
    invocation,
    registry,
    pair,
    invocation,
    operation,
    head,
    basis,
    ...(options.frozen ? [clone(basis)] : []),
    clone(operation),
    () => writes.findLast((write) => write.key === key)!.result,
  ]
  const accepted: OperationReceipt = {
    ...clone(operation),
    holdState: 'closed',
    contactState: 'accepted',
    appliedUsd: '0.3',
    acceptanceFingerprint: financialFingerprint({ appliedUsd: '0.3', executionTrigger: null }),
    acceptedAt: at,
    postedAt: at,
    financialClosureState: 'closed',
  }
  if (options.duplicate) receipts.splice(0, receipts.length, invocation, accepted)
  if (options.admit)
    receipts.splice(
      0,
      receipts.length,
      invocation,
      registry,
      pair,
      invocation,
      null,
      ...(identity.billingEnabled ? [head, basis] : []),
      null
    )
  const tx = {
    execute: async () => indexRows,
    select(selection?: Record<string, unknown>) {
      let table: unknown
      let joined = false
      let condition: SQL | undefined
      const query = {
        from(value: unknown) {
          table = value
          return query
        },
        where(value: SQL) {
          condition = value
          return query
        },
        limit() {
          return query
        },
        for() {
          locked.push(table)
          return query
        },
        orderBy() {
          return query
        },
        innerJoin() {
          joined = true
          return query
        },
        then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          try {
            queried.push(table)
            let rows: unknown[]
            if (table === tables.idempotencyKey) {
              if (options.admit && selection?.key && selection?.result) {
                const query = new PgDialect().sqlToQuery(condition!)
                if (query.sql.includes('holdState')) rows = clone(holds)
                else {
                  originalBatches.push(query.params)
                  rows = query.params.flatMap((key) => {
                    const result = typeof key === 'string' && originalInvocations.get(key)
                    return result ? [{ key, result: clone(result) }] : []
                  })
                }
              } else if (selection?.result) {
                const params = condition && new PgDialect().sqlToQuery(condition).params
                const historicalKey =
                  options.admit && originalBatches.length ? params?.at(-1) : undefined
                if (historicalKey === 'member-registry:v1') rows = [{ result: clone(registry) }]
                else if (
                  typeof historicalKey === 'string' &&
                  historicalKey.startsWith('member-registration:v1:')
                ) {
                  const userId = historicalKey.slice('member-registration:v1:'.length)
                  historicalMemberReads.push(userId)
                  const ledgerAnchor = financialFingerprint({ organizationId: root.id, userId })
                  rows = retainedMembers.has(userId)
                    ? [
                        {
                          result: {
                            ...clone(pair),
                            userId,
                            ledgerAnchor,
                            provenance: {
                              ...pair.provenance,
                              digest: financialFingerprint({
                                root,
                                userId,
                                ledgerAnchor,
                                actualMembershipId: 'unit-member-id',
                              }),
                            },
                          },
                        },
                      ]
                    : []
                } else {
                  const value = receipts.shift()
                  if (value === undefined) throw new Error('Unexpected extra receipt read')
                  rows =
                    value === null
                      ? []
                      : [{ result: typeof value === 'function' ? value() : clone(value) }]
                }
              } else rows = []
            } else if (table === tables.organization)
              rows = selection?.limit ? [{ limit: null }] : [{ id: root.id }]
            else if (
              table === tables.organizationBillingLedger ||
              table === tables.organizationMemberBillingLedger
            )
              rows =
                options.admit &&
                originalBatches.length &&
                condition &&
                table === tables.organizationMemberBillingLedger &&
                new PgDialect().sqlToQuery(condition).params.length === 2 &&
                !retainedMembers.has(String(new PgDialect().sqlToQuery(condition).params.at(-1)))
                  ? []
                  : [ledger]
            else if (table === tables.subscription)
              rows = !joined
                ? [
                    {
                      id: originalPeriod.subscriptionId,
                      referenceType: root.type,
                      referenceId: root.id,
                      stripeSubscriptionId: originalPeriod.stripeSubscriptionId,
                      stripeCustomerId: originalPeriod.customerId,
                      periodStart: new Date(originalPeriod.start!),
                      periodEnd: new Date(originalPeriod.end!),
                    },
                  ]
                : options.policy === false
                  ? []
                  : [
                      {
                        sub: {
                          ...originalPeriod,
                          id: originalPeriod.subscriptionId,
                          plan: 'unit-tier',
                          billingTierId: 'unit-tier',
                          referenceType: 'organization',
                          stripeSubscriptionId: originalPeriod.stripeSubscriptionId,
                          seats: 3,
                          stripeCustomerId: originalPeriod.customerId,
                          periodStart: new Date(originalPeriod.start!),
                          periodEnd: new Date(originalPeriod.end!),
                        },
                        tier: {
                          id: 'unit-tier',
                          ownerType: 'organization',
                          isDefault: false,
                          usageScope: options.member ? 'individual' : 'pooled',
                          includedUsageLimitUsd: '20',
                        },
                      },
                    ]
            else if (options.admit && table === tables.workspace)
              rows = [
                {
                  id: identity.workspaceId,
                  ownerId: 'unit-different-workspace-owner',
                  billingOwnerType: 'organization',
                  billingOwnerOrganizationId: root.id,
                },
              ]
            else if (options.admit && table === tables.permissions)
              rows = [{ id: 'unit-retained-workspace-permission' }]
            else if (options.admit && table === tables.member) {
              memberAuthorizationLocks.push([...locked])
              rows = options.currentMember === false ? [] : [{ id: 'unit-live-membership' }]
            } else throw new Error('Unexpected table in acceptance fixture')
            return Promise.resolve(rows).then(resolve, reject)
          } catch (error) {
            return Promise.reject(error).then(resolve, reject)
          }
        },
      }
      return query
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where() {
              updates.push({ table, values })
            },
          }
        },
      }
    },
    insert(table: unknown) {
      if (table !== tables.idempotencyKey) throw new Error('Unexpected target creation')
      return {
        values(value: { key: string; result: FinancialReceipt }) {
          return {
            async onConflictDoUpdate() {
              writes.push(clone(value))
            },
          }
        },
      }
    },
    delete() {
      throw new Error('No deletion in acceptance fixture')
    },
  } as unknown as FinancialTransaction
  return {
    tx,
    binding,
    occurrence,
    identity,
    operation,
    basis,
    head,
    receipts,
    updates,
    writes,
    queried,
    holds,
    originalInvocations,
    originalBatches,
    retainedMembers,
    historicalMemberReads,
    memberAuthorizationLocks,
    key,
    accepted,
  }
}

describe('new organization model admission requires the current original liable member', () => {
  it.each(['pooled', 'individual'] as const)(
    'admits a current %s actor using retained workspace access with a different workspace owner',
    async (scope) => {
      const member = scope === 'individual'
      const f = fixture({ admit: true, member })
      await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).resolves.toEqual({
        namespace,
        key: f.key,
      })
      expect(f.queried).toContain(tables.permissions)
      expect(f.queried).toContain(tables.member)
      expect(f.memberAuthorizationLocks).toHaveLength(1)
      for (const table of [
        tables.organization,
        tables.organizationBillingLedger,
        tables.organizationMemberBillingLedger,
        tables.idempotencyKey,
      ])
        expect(f.memberAuthorizationLocks[0]).toContain(table)
      expect(f.writes).toHaveLength(1)
      expect(f.writes[0]).toMatchObject({
        key: f.key,
        result: {
          recordType: 'operation',
          binding: f.binding,
          identity: {
            actorUserId: actor,
            memberUserId: member ? actor : null,
          },
          contactState: 'uncertain',
          holdState: 'outstanding',
          modelUsd: 'unavailable',
        },
      })
      expect(f.writes[0].result).not.toHaveProperty('appliedUsd')
      expect(f.updates).toEqual([])
      expect(f.receipts).toEqual([])
    }
  )

  it.each([
    { member: false, billingEnabled: true },
    { member: true, billingEnabled: true },
    { member: false, billingEnabled: false },
  ])(
    'refuses a removed liable member before writing a hold with policy %j',
    async ({ member, billingEnabled }) => {
      const f = fixture({ admit: true, member, billingEnabled, currentMember: false })
      await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toMatchObject({
        status: 403,
      })
      expect(f.queried).toContain(tables.permissions)
      expect(f.queried).toContain(tables.member)
      expect(f.queried).not.toContain(tables.subscription)
      expect(f.writes).toEqual([])
      expect(f.updates).toEqual([])
    }
  )

  it('retains current membership authorization when billing was disabled at original creation', async () => {
    const f = fixture({ admit: true, billingEnabled: false })
    await admitModelStep(f.tx, f.binding, f.occurrence, false)
    expect(f.queried).toContain(tables.member)
    expect(f.queried).not.toContain(tables.subscription)
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0].result).toMatchObject({
      recordType: 'operation',
      contactState: 'uncertain',
      holdState: 'closed',
    })
    expect(f.updates).toEqual([])
    expect(f.receipts).toEqual([])
  })

  it.each(['member', 'actor'] as const)(
    'refuses conflicting canonical %s liability without another hold',
    async (field) => {
      const f = fixture({ admit: true, member: true })
      if (field === 'member') f.identity.memberUserId = 'unit-other-liable-member'
      else f.binding.actorUserId = 'unit-other-actor'
      await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toMatchObject({
        status: 403,
      })
      expect(f.writes).toEqual([])
      expect(f.updates).toEqual([])
    }
  )

  it('classifies an already admitted occurrence before any new membership or policy decision', async () => {
    const f = fixture({ admit: true, currentMember: false })
    f.receipts[4] = f.operation
    await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toThrow(
      'already been admitted'
    )
    expect(f.queried).not.toContain(tables.member)
    expect(f.queried).not.toContain(tables.subscription)
    expect(f.writes).toEqual([])
    expect(f.updates).toEqual([])
  })
})

describe('historical outstanding holds retain proved original actor applicability', () => {
  function historical(
    f: ReturnType<typeof fixture>,
    options: { actor?: string; member?: boolean; amount?: string; index?: number } = {}
  ) {
    const index = options.index ?? f.holds.length
    const originalActor = options.actor ?? actor
    const identity: FinancialIdentity = {
      ...clone(f.identity),
      actorUserId: originalActor,
      memberUserId: options.member ? originalActor : null,
      scope: options.member ? 'organization_member' : 'organization',
      period: { ...originalPeriod, subscriptionId: `historical-subscription-${index}` },
      quote: { ...f.identity.quote, holdUsd: options.amount ?? '20' },
    }
    const binding: FinancialBinding = {
      ...f.binding,
      key: `invocation:historical-${index}`,
      runId: `historical-run-${index}`,
      actorUserId: originalActor,
      fingerprint: financialFingerprint({ identity, runId: `historical-run-${index}` }),
    }
    const key = occurrenceKey(binding, { stepNumber: 0, retryCount: 0 })
    const operation: OperationReceipt = {
      ...clone(f.operation),
      binding,
      identity,
      fingerprint: financialFingerprint([binding.fingerprint, key]),
    }
    const invocation: FinancialReceipt = {
      recordType: 'invocation',
      binding: clone(binding),
      identity: clone(identity),
      fingerprint: binding.fingerprint,
      financialClosureState: 'closed',
    }
    f.holds.push({ key, result: operation })
    f.originalInvocations.set(binding.key, invocation)
    f.retainedMembers.add(originalActor)
    return { operation, invocation, key }
  }

  it.each([false, true])(
    'reserves same-actor original member=%s hold20 before fresh contact',
    async (member) => {
      const f = fixture({ admit: true, member: true })
      const held = historical(f, { member })
      const before = clone(held)
      await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toMatchObject({
        status: 402,
      })
      expect(held).toEqual(before)
      expect(f.writes).toEqual([])
      expect(f.updates).toEqual([])
      expect(f.originalBatches).toHaveLength(1)
    }
  )

  it.each([false, true])(
    'excludes a proved different actor member=%s without reparenting',
    async (member) => {
      const f = fixture({ admit: true, member: true })
      const held = historical(f, { member, actor: 'different-original-actor' })
      const before = clone(held)
      await admitModelStep(f.tx, f.binding, f.occurrence, true)
      expect(held).toEqual(before)
      expect(f.writes).toHaveLength(1)
      expect(f.originalBatches).toHaveLength(1)
    }
  )

  it('admits exact equality and counts every applicable historical operation once', async () => {
    const f = fixture({ admit: true, member: true })
    historical(f, { amount: '10' })
    historical(f, { member: true, amount: '8' })
    await admitModelStep(f.tx, f.binding, f.occurrence, true)
    expect(f.writes).toHaveLength(1)
    expect(f.originalBatches).toHaveLength(1)
  })

  function sameAnchorHolds() {
    const f = fixture({ admit: true, member: true })
    const first = historical(f, { amount: '9.5' })
    const key = occurrenceKey(first.operation.binding, { stepNumber: 1, retryCount: 0 })
    const second = clone(first.operation)
    second.fingerprint = financialFingerprint([second.binding.fingerprint, key])
    f.holds.push({ key, result: second })
    return { f, first, second, key }
  }
  it('reserves every distinct operation sharing one original invocation anchor', async () => {
    const { f } = sameAnchorHolds()
    await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toMatchObject({
      status: 402,
    })
    expect(f.originalBatches).toHaveLength(1)
    expect(f.originalBatches[0]).toHaveLength(2)
    expect(f.writes).toEqual([])
  })
  it.each(['binding', 'identity'] as const)(
    'never authenticates a later conflicting %s from an earlier same-anchor candidate',
    async (field) => {
      const { f, second, key } = sameAnchorHolds()
      if (field === 'binding') Object.assign(second.binding, { conflictingOriginal: 'changed' })
      else {
        second.identity.quote.holdUsd = '1'
        second.binding.fingerprint = financialFingerprint({
          identity: second.identity,
          runId: second.binding.runId,
        })
        second.fingerprint = financialFingerprint([second.binding.fingerprint, key])
      }
      const before = clone(f.holds)
      await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toThrow(
        'unprovable original financial-record evidence'
      )
      expect(f.holds).toEqual(before)
      expect(f.writes).toEqual([])
      expect(f.updates).toEqual([])
    }
  )

  it('refuses stale fingerprints even when every held identity matches the changed original', async () => {
    const { f, first, second } = sameAnchorHolds()
    first.invocation.identity.quote.holdUsd = '1'
    first.operation.identity.quote.holdUsd = '1'
    second.identity.quote.holdUsd = '1'
    const before = clone({ holds: f.holds, invocations: [...f.originalInvocations] })
    await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toThrow(
      'unprovable original financial-record evidence'
    )
    expect({ holds: f.holds, invocations: [...f.originalInvocations] }).toEqual(before)
    expect(f.writes).toEqual([])
    expect(f.updates).toEqual([])
  })

  it.each([
    { lastAmount: '8', admitted: true },
    { lastAmount: '8.00000000000000001', admitted: false },
    { lastAmount: '7.99999999999999999', admitted: true },
  ])(
    'keeps exact admission at100/101 holds with final amount $lastAmount',
    async ({ lastAmount, admitted }) => {
      const f = fixture({ admit: true, member: true })
      for (let index = 0; index < 100; index++) historical(f, { amount: '0.1', index })
      historical(f, { amount: lastAmount, index: 100 })
      const before = clone({ holds: f.holds, invocations: [...f.originalInvocations] })
      if (admitted) {
        await admitModelStep(f.tx, f.binding, f.occurrence, true)
        expect(f.writes).toHaveLength(1)
      } else {
        await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toMatchObject({
          status: 402,
        })
        expect(f.writes).toEqual([])
      }
      expect({ holds: f.holds, invocations: [...f.originalInvocations] }).toEqual(before)
      expect(f.updates).toEqual([])
    }
  )

  it.each([
    'missing actor',
    'blank actor',
    'member conflict',
    'scope conflict',
    'binding actor',
    'foreign root',
    'fingerprint',
    'missing invocation',
    'changed invocation',
    'missing invocation binding',
    'missing invocation identity',
    'self-consistent changed actor',
    'accepted outstanding',
    'noncanonical money',
  ])('refuses %s proof before another hold and preserves original evidence', async (fault) => {
    const f = fixture({ admit: true, member: true })
    const held = historical(f, { actor: 'different-original-actor' })
    const operation = held.operation
    if (fault === 'missing actor') Reflect.deleteProperty(operation.identity, 'actorUserId')
    if (fault === 'blank actor') operation.identity.actorUserId = ' '
    if (fault === 'member conflict') operation.identity.memberUserId = actor
    if (fault === 'scope conflict') operation.identity.scope = 'organization_member'
    if (fault === 'binding actor') operation.binding.actorUserId = actor
    if (fault === 'foreign root')
      operation.identity.root = { type: 'organization', id: 'different-root' }
    if (fault === 'fingerprint') operation.fingerprint = 'missing-original-fingerprint'
    if (fault === 'missing invocation') f.originalInvocations.clear()
    if (fault === 'changed invocation') held.invocation.identity.quote.holdUsd = '999'
    if (fault === 'missing invocation binding') Reflect.deleteProperty(held.invocation, 'binding')
    if (fault === 'missing invocation identity') Reflect.deleteProperty(held.invocation, 'identity')
    if (fault === 'self-consistent changed actor') {
      operation.identity.actorUserId = actor
      operation.binding.actorUserId = actor
      operation.binding.fingerprint = financialFingerprint({
        identity: operation.identity,
        runId: operation.binding.runId,
      })
      operation.fingerprint = financialFingerprint([operation.binding.fingerprint, held.key])
    }
    if (fault === 'accepted outstanding') operation.contactState = 'accepted'
    if (fault === 'noncanonical money') operation.identity.quote.holdUsd = '20.0'
    const before = clone({ holds: f.holds, invocations: [...f.originalInvocations] })
    await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toThrow(
      'unprovable original financial-record evidence'
    )
    expect({ holds: f.holds, invocations: [...f.originalInvocations] }).toEqual(before)
    expect(f.writes).toEqual([])
    expect(f.updates).toEqual([])
  })

  it('bounds original invocation point reads to100 and avoids reads with no outstanding holds', async () => {
    const empty = fixture({ admit: true, member: true })
    await admitModelStep(empty.tx, empty.binding, empty.occurrence, true)
    expect(empty.originalBatches).toEqual([])
    const f = fixture({ admit: true, member: true })
    for (let index = 0; index < 201; index++) historical(f, { index, amount: '0.001' })
    await admitModelStep(f.tx, f.binding, f.occurrence, true)
    expect(f.originalBatches.map((params) => params.length - 1)).toEqual([100, 100, 1])
    expect(f.writes).toHaveLength(1)
  })

  it('retains pooled all-root aggregation without actor filtering or duplicate invocation reads', async () => {
    const f = fixture({ admit: true })
    historical(f, { member: true, actor: 'different-original-actor', amount: '60' })
    await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toMatchObject({
      status: 402,
    })
    expect(f.originalBatches).toEqual([])
    expect(f.writes).toEqual([])
  })

  it('proves a departed original target once and refuses a missing retained target before exclusion', async () => {
    const f = fixture({ admit: true, member: true })
    historical(f, { actor: 'departed-original-actor', amount: '5' })
    historical(f, { actor: 'departed-original-actor', member: true, amount: '5' })
    await admitModelStep(f.tx, f.binding, f.occurrence, true)
    expect(f.historicalMemberReads).toEqual(['departed-original-actor'])
    const missing = fixture({ admit: true, member: true })
    historical(missing, { actor: 'departed-original-actor' })
    missing.retainedMembers.delete('departed-original-actor')
    await expect(
      admitModelStep(missing.tx, missing.binding, missing.occurrence, true)
    ).rejects.toThrow('unregistered')
    expect(missing.writes).toEqual([])
    expect(missing.updates).toEqual([])
  })
})

describe('original incurred settlement after current-head organization cancellation', () => {
  it('settles a normal unfrozen current period only with its effective current policy', async () => {
    const f = fixture()
    const accepted = await acceptModelStep(f.tx, f.binding, f.occurrence, {
      permittedProductUsd: '0.3',
      usage: { totalTokens: 12 },
    })
    expect(accepted.contactState).toBe('accepted')
    expect(f.queried.filter((table) => table === tables.subscription)).toHaveLength(1)
    expect(f.updates[0].values).toHaveProperty('currentPeriodCost')
    expect(f.updates[0].values).not.toHaveProperty('lastPeriodCost')
  })
  it.each([false, true])(
    'settles proven frozen current-head basis with individual member:%s and no active successor',
    async (member) => {
      const f = fixture({ frozen: true, policy: false, member })
      const accepted = await acceptModelStep(f.tx, f.binding, f.occurrence, {
        permittedProductUsd: '0.3',
        usage: { totalTokens: 12 },
      })
      expect(accepted).toMatchObject({
        appliedUsd: '0.3',
        holdState: 'closed',
        contactState: 'accepted',
      })
      expect(f.queried).not.toContain(tables.subscription)
      expect(f.queried).not.toContain(tables.member)
      expect(f.updates).toHaveLength(member ? 2 : 1)
      for (const update of f.updates) {
        expect(update.values).toHaveProperty('currentPeriodCost')
        expect(update.values).toHaveProperty('currentPeriodCopilotCost')
        expect(update.values).toHaveProperty('totalCopilotCalls')
        expect(update.values).not.toHaveProperty('lastPeriodCost')
      }
      const closing = f.writes.find((write) => write.key === periodKey(originalPeriod))!
        .result as PeriodReceipt
      expect(closing.closing).toMatchObject({
        acceptedUsd: '1.3',
        copilotUsd: '1.3',
        allowanceUsd: '20',
      })
      if (member) expect(closing.closing!.memberUsd[actor]).toBe('1.3')
      expect(f.writes.some((write) => write.key === 'period-head')).toBe(false)
    }
  )
  it.each(['previous', 'older'] as const)(
    'preserves %s slot projection for frozen incurred original acceptance',
    async (slot) => {
      const f = fixture({ frozen: true, policy: false, slot })
      await acceptModelStep(f.tx, f.binding, f.occurrence, { permittedProductUsd: '0.3' })
      expect(f.updates[0].values).not.toHaveProperty('currentPeriodCost')
      expect(Object.hasOwn(f.updates[0].values, 'lastPeriodCost')).toBe(slot === 'previous')
      expect(f.updates[0].values).toHaveProperty('totalCost')
    }
  )
  it('returns accepted duplicate without policy reread, additional counters, mutation or contact', async () => {
    const f = fixture({ duplicate: true, policy: false })
    expect(
      await acceptModelStep(f.tx, f.binding, f.occurrence, { permittedProductUsd: '0.3' })
    ).toEqual(f.accepted)
    expect(f.updates).toEqual([])
    expect(f.writes).toEqual([])
    expect(f.queried).not.toContain(tables.subscription)
    expect(f.queried).not.toContain(tables.member)
  })
  it('refuses changed duplicate intent without another write', async () => {
    const f = fixture({ duplicate: true })
    await expect(
      acceptModelStep(f.tx, f.binding, f.occurrence, { permittedProductUsd: '0.4' })
    ).rejects.toThrow('intent')
    expect(f.writes).toEqual([])
    expect(f.updates).toEqual([])
  })
  it('refuses current canceled period without a frozen original basis', async () => {
    const f = fixture({ policy: false })
    await expect(
      acceptModelStep(f.tx, f.binding, f.occurrence, { permittedProductUsd: '0.3' })
    ).rejects.toThrow('subscription')
    expect(f.writes).toEqual([])
    expect(f.updates).toEqual([])
  })
  it.each(['root', 'period', 'mode', 'timestamp', 'member'] as const)(
    'refuses corrupted original frozen %s without recreating targets',
    async (field) => {
      const f = fixture({ frozen: true, policy: false, member: true })
      if (field === 'root') f.basis.root = { type: 'organization', id: 'another-owner' }
      if (field === 'period')
        f.basis.period = { ...originalPeriod, subscriptionId: 'another-subscription' }
      if (field === 'mode') f.basis.closing!.mode = 'user'
      if (field === 'timestamp') f.basis.closing!.frozenAt = 'not-an-ISO-date'
      if (field === 'member') delete f.basis.closing!.memberUsd[actor]
      await expect(
        acceptModelStep(f.tx, f.binding, f.occurrence, { permittedProductUsd: '0.3' })
      ).rejects.toThrow()
      expect(f.writes).toEqual([])
      expect(f.updates).toEqual([])
    }
  )
})

describe('reversible original-period eligibility', () => {
  it.each([false, true])(
    'accepts incurred suspended work with individual member:%s',
    async (member) => {
      const f = fixture({ suspended: true, policy: false, member })
      const result = await acceptModelStep(f.tx, f.binding, f.occurrence, {
        permittedProductUsd: '0.3',
      })
      expect(result).toMatchObject({
        appliedUsd: '0.3',
        contactState: 'accepted',
        holdState: 'closed',
      })
      expect(f.updates).toHaveLength(member ? 2 : 1)
      expect(f.updates[0].values).toHaveProperty('currentPeriodCost')
      expect(f.writes.some((row) => row.key === periodKey(originalPeriod))).toBe(false)
      expect(f.basis.suspension!.allowanceUsd).toBe('20')
    }
  )
  it('captures canonical entitlement without copying or resetting money', async () => {
    const f = fixture()
    f.receipts.splice(0, f.receipts.length, f.head, f.head, f.basis, clone(f.basis))
    const result = await suspendFinancialPeriodEligibility(f.tx, root, originalPeriod)
    expect(result.suspension).toMatchObject({
      allowanceUsd: '60',
      mode: 'pooled',
      defaultGrant: false,
    })
    expect(result.closing).toBeNull()
    expect(f.updates).toEqual([])
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0].key).toBe(periodKey(originalPeriod))
  })
  it('restores only reversible authority without monetary writes or financial replay', async () => {
    const f = fixture({ suspended: true })
    f.receipts.splice(0, f.receipts.length, f.head, f.basis, clone(f.basis))
    const result = await resumeFinancialPeriodEligibility(f.tx, root, originalPeriod)
    expect(result.suspension).toBeUndefined()
    expect(result.commitments).toEqual({ issuedUsd: '0', pendingUsd: '0' })
    expect(f.updates).toEqual([])
    expect(f.writes).toHaveLength(1)
  })
  it.each(['capture', 'restore'] as const)(
    'never reopens genuine closing during %s',
    async (action) => {
      const f = fixture({ frozen: true })
      f.receipts.splice(
        0,
        f.receipts.length,
        f.head,
        ...(action === 'capture' ? [f.head] : []),
        f.basis
      )
      await expect(
        (action === 'capture'
          ? suspendFinancialPeriodEligibility
          : resumeFinancialPeriodEligibility)(f.tx, root, originalPeriod)
      ).rejects.toThrow('Closed')
      expect(f.writes).toEqual([])
      expect(f.updates).toEqual([])
    }
  )
  it.each(['closing', 'suspended'] as const)(
    'refuses existing-binding fresh admission on %s authority',
    async (kind) => {
      const f = fixture({
        admit: true,
        frozen: kind === 'closing',
        suspended: kind === 'suspended',
      })
      await expect(admitModelStep(f.tx, f.binding, f.occurrence, true)).rejects.toThrow(
        'Open financial basis'
      )
      expect(f.writes).toEqual([])
    }
  )
  it.each(['mint', 'edit', 'clear'] as const)(
    'generic receipt writes cannot %s suspended authority',
    async (action) => {
      const f = fixture({ suspended: action !== 'mint' })
      const next = clone(f.basis)
      if (action === 'clear') next.suspension = undefined
      else
        next.suspension = {
          allowanceUsd: '999',
          mode: 'pooled',
          defaultGrant: false,
          capturedAt: at,
        }
      f.receipts.splice(0, f.receipts.length, f.basis)
      await expect(
        writeFinancialReceipt(f.tx, namespace, periodKey(originalPeriod), next)
      ).rejects.toThrow('canonical transition')
      expect(f.writes).toEqual([])
    }
  )
  it.each(['money', 'mode', 'timestamp', 'grant', 'extra'] as const)(
    'refuses malformed suspended %s before any posting',
    async (field) => {
      const f = fixture({ suspended: true })
      if (field === 'money') f.basis.suspension!.allowanceUsd = '01'
      if (field === 'mode') f.basis.suspension!.mode = 'user'
      if (field === 'timestamp') f.basis.suspension!.capturedAt = 'not-a-date'
      if (field === 'grant') f.basis.suspension!.defaultGrant = true
      if (field === 'extra') Object.assign(f.basis.suspension!, { closing: true })
      await expect(
        acceptModelStep(f.tx, f.binding, f.occurrence, { permittedProductUsd: '0.3' })
      ).rejects.toThrow()
      expect(f.updates).toEqual([])
      expect(f.writes).toEqual([])
    }
  )
})

// One JSON receipt and inert root anchors suffice for the public claim/preparation boundaries.
// This double supplies no SQL locking or transaction proof; disposable PostgreSQL owns that proof.
function invoiceDispatchFixture(markerPatch: Record<string, unknown> = {}) {
  const invoiceRoot = { type: 'user' as const, id: 'unit-original-invoice-owner' }
  const invoiceNamespace = financialNamespace(invoiceRoot)
  const candidate = { namespace: invoiceNamespace, key: 'invoice:original-intent', due: 10 }
  const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  let stored: InvoiceReceipt = jsonCopy({
    recordType: 'invoice',
    root: invoiceRoot,
    period: originalPeriod,
    fingerprint: financialFingerprint({ period: originalPeriod, amountCents: '1257' }),
    amountCents: '1257',
    currency: 'usd',
    requestKey: 'unit-original-invoice-request',
    subtype: 'final',
    issuance: 'pending',
    invoiceObligationState: 'open',
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: 500,
    markers: [
      {
        id: 'unit-original-phase',
        kind: 'invoice',
        phase: 'create',
        state: 'claimed',
        attempts: 1,
        failedAttempts: 2,
        nextAtMs: 10,
        claimId: 'unit-expired-claim',
        claimExpiresAtMs: 500,
        ...markerPatch,
      },
    ],
  })
  const writes: { namespace: string; key: string; result: FinancialReceipt }[] = []
  const locks: unknown[] = []
  const tx = {
    execute: async () => indexRows,
    select(selection?: Record<string, unknown>) {
      let table: unknown
      const query = {
        from(value: unknown) {
          table = value
          return query
        },
        where() {
          return query
        },
        limit() {
          return query
        },
        orderBy() {
          return query
        },
        for() {
          locks.push(table)
          return query
        },
        then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          let rows: unknown[]
          if (table === tables.idempotencyKey)
            rows = selection?.result ? [{ result: jsonCopy(stored) }] : [{ key: candidate.key }]
          else if (table === tables.user) rows = [{ id: invoiceRoot.id }]
          else if (table === tables.userStats) rows = []
          else
            return Promise.reject(new Error('Unexpected invoice dispatch fixture read')).then(
              resolve,
              reject
            )
          return Promise.resolve(rows).then(resolve, reject)
        },
      }
      return query
    },
    insert(table: unknown) {
      if (table !== tables.idempotencyKey) throw new Error('No new financial target creation')
      return {
        values(value: { namespace: string; key: string; result: InvoiceReceipt }) {
          if (value.namespace !== invoiceNamespace || value.key !== candidate.key)
            throw new Error('Original invoice target changed')
          return {
            async onConflictDoUpdate() {
              stored = jsonCopy(value.result)
              writes.push(jsonCopy(value))
            },
          }
        },
      }
    },
    update() {
      throw new Error('Claim/preparation must not repost ledger accounting')
    },
    delete() {
      throw new Error('Claim/preparation must not remove financial evidence')
    },
  } as unknown as FinancialTransaction
  const read = () => jsonCopy(stored)
  return {
    tx,
    candidate,
    writes,
    locks,
    read,
    mutate(run: (receipt: InvoiceReceipt) => void) {
      const next = read()
      run(next)
      stored = jsonCopy(next)
    },
    existingClaim(): DispatchClaim {
      const receipt = read()
      return {
        candidate,
        receipt,
        marker: jsonCopy(receipt.markers[0]),
        root: invoiceRoot,
        reconcile: true,
      }
    },
  }
}
function preparedInvoiceContact(overrides: Record<string, unknown> = {}) {
  return {
    requestKey: 'unit-original-invoice-request:create',
    requestFingerprint: financialFingerprint({ intent: 'unit-original-intent', phase: 'create' }),
    provider: 'stripe',
    firstContactAtMs: 20,
    ...overrides,
  }
}
describe('raw signed invoice settlement rechecks actual locked state', () => {
  for (const paid of [false, true]) {
    it(`keeps a closed original duplicate harmless without an entity lock, paid:${paid}`, async () => {
      const f = invoiceDispatchFixture()
      f.mutate((row) => {
        row.invoiceObligationState = 'closed'
        row.invoiceId = 'in_original'
      })
      f.tx.execute = async () => {
        throw new Error('Deleted original entity must not be locked')
      }
      const intent = f.read()
      await acceptInvoicePayment(f.tx, {
        namespace: f.candidate.namespace,
        key: f.candidate.key,
        invoiceId: 'in_original',
        customerId: originalPeriod.customerId!,
        amountCents: intent.amountCents,
        currency: 'usd',
        paid,
        fingerprint: intent.fingerprint,
        period: originalPeriod,
      })
      expect(f.writes).toEqual([])
      expect(f.locks).toEqual([])
    })
  }
  it('does not append failure or touch a ledger after the locked reread observes another payment', async () => {
    const f = invoiceDispatchFixture()
    f.mutate((row) => {
      row.invoiceId = 'in_original'
    })
    const original = f.read()
    const execute = f.tx.execute.bind(f.tx)
    f.tx.execute = async (...args: Parameters<typeof f.tx.execute>) => {
      f.mutate((row) => {
        row.invoiceObligationState = 'closed'
      })
      return execute(...args)
    }
    await acceptInvoicePayment(f.tx, {
      namespace: f.candidate.namespace,
      key: f.candidate.key,
      invoiceId: 'in_original',
      customerId: originalPeriod.customerId!,
      amountCents: original.amountCents,
      currency: 'usd',
      paid: false,
      fingerprint: original.fingerprint,
      period: originalPeriod,
    })
    expect(f.writes).toEqual([])
    expect(f.read().markers).toEqual(original.markers)
    expect(f.read().invoiceObligationState).toBe('closed')
  })
  it.each(['fingerprint', 'period'] as const)(
    'revalidates locked original %s rather than trusting the initial read',
    async (field) => {
      const f = invoiceDispatchFixture()
      const original = f.read()
      const execute = f.tx.execute.bind(f.tx)
      f.tx.execute = async (...args: Parameters<typeof f.tx.execute>) => {
        f.mutate((row) => {
          if (field === 'fingerprint') row.fingerprint = 'changed'
          else row.period = { ...row.period, subscriptionId: 'different-original' }
        })
        return execute(...args)
      }
      await expect(
        acceptInvoicePayment(f.tx, {
          namespace: f.candidate.namespace,
          key: f.candidate.key,
          invoiceId: 'in_original',
          customerId: originalPeriod.customerId!,
          amountCents: original.amountCents,
          currency: 'usd',
          paid: false,
          fingerprint: original.fingerprint,
          period: originalPeriod,
        })
      ).rejects.toThrow('binding mismatch')
      expect(f.writes).toEqual([])
    }
  )
})
const invoicePreparation = (now = 1000) => ({
  provider: 'stripe' as const,
  requestKey: 'unit-original-invoice-request:create',
  fingerprint: financialFingerprint({ intent: 'unit-original-intent', phase: 'create' }),
  now,
})
function originalInvoiceFacts(receipt: InvoiceReceipt) {
  const {
    markers: _markers,
    dispatchAtMs: _dispatchAtMs,
    dispatchState: _dispatchState,
    ...facts
  } = receipt
  return facts
}

describe('invoice dispatch recovery uses persisted phase preparation and claim CAS', () => {
  it('reclaims a valid expired unprepared phase with a new claim and no reconciliation or accounting', async () => {
    const f = invoiceDispatchFixture()
    const before = f.read()
    const claim = await claimFinancialDispatch(f.tx, f.candidate, 1000)
    expect(claim).not.toBeNull()
    expect(claim!.reconcile).toBe(false)
    expect(claim!.marker.claimId).not.toBe(before.markers[0].claimId)
    expect(claim!.marker).toMatchObject({
      id: before.markers[0].id,
      phase: 'create',
      state: 'claimed',
      attempts: 2,
      failedAttempts: 2,
      nextAtMs: 10,
      claimExpiresAtMs: 121000,
    })
    for (const field of [
      'requestKey',
      'requestFingerprint',
      'provider',
      'firstContactAtMs',
      'providerId',
      'payload',
    ])
      expect(claim!.marker).not.toHaveProperty(field)
    expect(originalInvoiceFacts(f.read())).toEqual(originalInvoiceFacts(before))
    expect(f.writes).toHaveLength(1)
    expect(f.locks).toContain(tables.user)
    expect(f.locks).toContain(tables.userStats)
    expect(f.locks).toContain(tables.idempotencyKey)
  })

  it('repeats definite pre-preparation recovery without converting expiry into producer death or contact evidence', async () => {
    const f = invoiceDispatchFixture()
    const first = await claimFinancialDispatch(f.tx, f.candidate, 1000)
    const second = await claimFinancialDispatch(
      f.tx,
      f.candidate,
      first!.marker.claimExpiresAtMs! + 1
    )
    expect(second!.reconcile).toBe(false)
    expect(second!.marker.claimId).not.toBe(first!.marker.claimId)
    expect(second!.marker.attempts).toBe(3)
    expect(second!.marker.failedAttempts).toBe(2)
    expect(second!.marker).not.toHaveProperty('firstContactAtMs')
    expect(
      await claimFinancialDispatch(f.tx, f.candidate, second!.marker.claimExpiresAtMs! - 1)
    ).toBeNull()
    expect(f.writes).toHaveLength(2)
  })

  it('fences stale preparation by claim CAS before any evidence changes, while the new claim can prepare once', async () => {
    const f = invoiceDispatchFixture()
    const stale = f.existingClaim()
    const current = await claimFinancialDispatch(f.tx, f.candidate, 1000)
    const before = f.read()
    await expect(prepareFinancialContact(f.tx, stale, invoicePreparation())).rejects.toThrow(
      'claim was lost'
    )
    expect(f.read()).toEqual(before)
    expect(f.writes).toHaveLength(1)
    await prepareFinancialContact(f.tx, current!, invoicePreparation())
    expect(f.read().markers[0]).toMatchObject({
      ...preparedInvoiceContact(),
      firstContactAtMs: 1000,
      claimId: current!.marker.claimId,
    })
    expect(originalInvoiceFacts(f.read())).toEqual(originalInvoiceFacts(before))
    expect(f.writes).toHaveLength(2)
  })

  it('treats committed preparation before HTTP as possible contact and never renews its retention timestamp', async () => {
    const f = invoiceDispatchFixture({
      state: 'pending',
      attempts: 0,
      claimId: undefined,
      claimExpiresAtMs: undefined,
    })
    const initial = await claimFinancialDispatch(f.tx, f.candidate, 1000)
    await prepareFinancialContact(f.tx, initial!, invoicePreparation(1010))
    const expiry = initial!.marker.claimExpiresAtMs! + 1
    const recovered = await claimFinancialDispatch(f.tx, f.candidate, expiry)
    expect(recovered!.reconcile).toBe(true)
    expect(recovered!.marker.firstContactAtMs).toBe(1010)
    await prepareFinancialContact(f.tx, recovered!, invoicePreparation(expiry + 10))
    expect(f.read().markers[0].firstContactAtMs).toBe(1010)
    expect(f.read().markers[0].requestKey).toBe(invoicePreparation().requestKey)
    expect(f.read().markers[0].requestFingerprint).toBe(invoicePreparation().fingerprint)
  })

  it.each(['pending', 'uncertain', 'claimed'] as const)(
    'keeps a fully prepared %s phase in reconciliation with original IDs and exact money',
    async (state) => {
      const f = invoiceDispatchFixture({ ...preparedInvoiceContact(), state })
      f.mutate((row) => {
        row.invoiceId = 'in_original'
        row.itemId = 'ii_original'
      })
      const before = f.read()
      const claim = await claimFinancialDispatch(f.tx, f.candidate, 1000)
      expect(claim!.reconcile).toBe(true)
      expect(claim!.marker).toMatchObject(preparedInvoiceContact())
      expect(originalInvoiceFacts(f.read())).toEqual(originalInvoiceFacts(before))
      expect(f.read().amountCents).toBe('1257')
    }
  )

  it('refuses explicit uncertainty without preparation instead of laundering it through a new claim', async () => {
    const f = invoiceDispatchFixture({ state: 'uncertain' })
    const before = f.read()
    await expect(claimFinancialDispatch(f.tx, f.candidate, 1000)).rejects.toThrow('classification')
    expect(f.read()).toEqual(before)
    expect(f.writes).toEqual([])
  })

  it('retains valid provider IDs and payload evidence while reconciling an already prepared phase', async () => {
    const evidence = { retained: 'original-contact-evidence' }
    const f = invoiceDispatchFixture(
      preparedInvoiceContact({ providerId: 'in_original', payload: evidence })
    )
    const recovered = await claimFinancialDispatch(f.tx, f.candidate, 1000)
    expect(recovered!.reconcile).toBe(true)
    await prepareFinancialContact(f.tx, recovered!, invoicePreparation(1100))
    expect(f.read().markers[0]).toMatchObject({
      providerId: 'in_original',
      payload: evidence,
      firstContactAtMs: 20,
    })
    expect(f.writes).toHaveLength(2)
  })

  it.each([
    ['timestamp only', { firstContactAtMs: 20 }],
    ['request key only', { requestKey: 'original' }],
    ['fingerprint only', { requestFingerprint: 'original' }],
    ['provider only', { provider: 'stripe' }],
    ['provider ID only', { providerId: 'in_original' }],
    ['payload only', { payload: {} }],
    ['null timestamp', preparedInvoiceContact({ firstContactAtMs: null })],
    ['empty key', preparedInvoiceContact({ requestKey: '' })],
    ['empty fingerprint', preparedInvoiceContact({ requestFingerprint: ' ' })],
    ['different provider', preparedInvoiceContact({ provider: 'resend' })],
    ['negative timestamp', preparedInvoiceContact({ firstContactAtMs: -1 })],
    ['fractional timestamp', preparedInvoiceContact({ firstContactAtMs: 0.5 })],
    ['future timestamp', preparedInvoiceContact({ firstContactAtMs: 1001 })],
    ['empty provider ID', preparedInvoiceContact({ providerId: '' })],
    ['null provider ID', preparedInvoiceContact({ providerId: null })],
    ['null payload', preparedInvoiceContact({ payload: null })],
    ['array payload', preparedInvoiceContact({ payload: [] })],
  ] as const)(
    'refuses persisted %s evidence without a new claim or overwrite',
    async (_label, patch) => {
      const f = invoiceDispatchFixture(patch)
      const before = f.read()
      await expect(claimFinancialDispatch(f.tx, f.candidate, 1000)).rejects.toThrow(
        'classification'
      )
      await expect(
        prepareFinancialContact(f.tx, f.existingClaim(), invoicePreparation())
      ).rejects.toThrow('classification')
      expect(f.read()).toEqual(before)
      expect(f.writes).toEqual([])
    }
  )

  it.each([
    ['missing claim ID', { claimId: undefined }],
    ['empty claim ID', { claimId: '' }],
    ['missing expiry', { claimExpiresAtMs: undefined }],
    ['fractional expiry', { claimExpiresAtMs: 500.5 }],
    ['zero claimed attempts', { attempts: 0 }],
    ['negative failures', { failedAttempts: -1 }],
    ['fractional eligibility', { nextAtMs: 0.5 }],
    ['unsupported phase', { phase: 'unknown' }],
  ] as const)('refuses malformed %s before using absence as retry proof', async (_label, patch) => {
    const f = invoiceDispatchFixture(patch)
    const before = f.read()
    await expect(claimFinancialDispatch(f.tx, f.candidate, 1000)).rejects.toThrow('classification')
    expect(f.read()).toEqual(before)
    expect(f.writes).toEqual([])
  })

  it.each(['requestKey', 'fingerprint', 'provider'] as const)(
    'preserves a prepared original %s on changed preparation intent',
    async (field) => {
      const f = invoiceDispatchFixture(preparedInvoiceContact())
      const before = f.read()
      const input = invoicePreparation()
      if (field === 'requestKey') input.requestKey = 'replacement-request'
      else if (field === 'fingerprint') input.fingerprint = 'replacement-fingerprint'
      else Object.assign(input, { provider: 'azure' })
      await expect(prepareFinancialContact(f.tx, f.existingClaim(), input)).rejects.toThrow(
        'fingerprint changed'
      )
      expect(f.read()).toEqual(before)
      expect(f.writes).toEqual([])
    }
  )

  it.each([
    ['empty key', { requestKey: '' }],
    ['empty fingerprint', { fingerprint: '' }],
    ['noninvoice provider', { provider: 'azure' }],
    ['negative time', { now: -1 }],
    ['fractional time', { now: 0.5 }],
  ] as const)('refuses proposed %s before persisting preparation', async (_label, patch) => {
    const f = invoiceDispatchFixture()
    const before = f.read()
    const input = { ...invoicePreparation(), ...patch }
    await expect(prepareFinancialContact(f.tx, f.existingClaim(), input)).rejects.toThrow(
      'classification'
    )
    expect(f.read()).toEqual(before)
    expect(f.writes).toEqual([])
  })

  it('does not change generic expired notification-head recovery', async () => {
    const f = invoiceDispatchFixture({ kind: 'notification', phase: 'invoice-failure-fanout' })
    const recovered = await claimFinancialDispatch(f.tx, f.candidate, 1000)
    expect(recovered!.reconcile).toBe(true)
    expect(recovered!.marker.kind).toBe('notification')
    expect(recovered!.marker.claimId).not.toBe('unit-expired-claim')
  })
})

// Deliberately small storage doubles below prove policy outcomes only; actual SQL/CAS is PG evidence.
function integrityFixture() {
  const root = { type: 'user' as const, id: 'unit-integrity-owner' }
  const namespace = financialNamespace(root)
  const fingerprint = financialFingerprint({ original: 'accepted-unit-invoice' })
  const prefix = `invoice:${financialFingerprint(originalPeriod)}:`
  const candidate = { namespace, key: `${prefix}${fingerprint}`, due: 0 }
  let stored: InvoiceReceipt = {
    recordType: 'invoice',
    root,
    period: originalPeriod,
    fingerprint,
    amountCents: '1257',
    currency: 'usd',
    requestKey: `billing:${fingerprint}`,
    subtype: 'final',
    invoiceObligationState: 'open',
    issuance: 'pending',
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: 0,
    markers: [
      {
        id: 'original-head',
        kind: 'invoice',
        phase: 'create',
        state: 'pending',
        attempts: 0,
        failedAttempts: 0,
        nextAtMs: 0,
        requestKey: 'partial-original-request',
      },
    ],
  }
  const basis: PeriodReceipt = {
    recordType: 'period',
    root,
    period: originalPeriod,
    commitments: { pendingUsd: '12.57', issuedUsd: '0' },
    invoicePrefix: prefix,
    closing: null,
    financialClosureState: 'open',
    dispatchState: 'complete',
    dispatchAtMs: 0,
    markers: [],
  }
  let reads = 0
  let allowUpdate = true
  let writes = 0
  const tx = {
    execute: async () => indexRows,
    select(selection?: Record<string, unknown>) {
      let table: unknown
      const q = {
        from(value: unknown) {
          table = value
          return q
        },
        where() {
          return q
        },
        limit() {
          return q
        },
        for() {
          return q
        },
        orderBy() {
          return q
        },
        then(yes: (rows: unknown[]) => unknown, no: (error: unknown) => unknown) {
          let rows: unknown[]
          if (table === tables.idempotencyKey)
            rows = selection?.result
              ? [{ result: clone((reads++ % 4) % 2 === 1 ? basis : stored) }]
              : [{ key: candidate.key }]
          else if (table === tables.user) rows = [{ id: root.id }]
          else if (table === tables.subscription)
            rows = [
              {
                id: originalPeriod.subscriptionId,
                referenceType: root.type,
                referenceId: root.id,
                stripeSubscriptionId: originalPeriod.stripeSubscriptionId,
                stripeCustomerId: originalPeriod.customerId,
                periodStart: new Date(originalPeriod.start!),
                periodEnd: new Date(originalPeriod.end!),
              },
            ]
          else if (table === tables.userStats)
            rows = [
              {
                totalCost: '20',
                currentPeriodCost: '20',
                lastPeriodCost: '0',
                currentPeriodCopilotCost: '0',
                billedOverage: '0',
                blocked: false,
              },
            ]
          else return Promise.reject(new Error('Unexpected integrity fixture query')).then(yes, no)
          return Promise.resolve(rows).then(yes, no)
        },
      }
      return q
    },
    update(table: unknown) {
      if (table !== tables.idempotencyKey)
        throw new Error('Classification cannot post ledger money')
      return {
        set(value: { result: InvoiceReceipt }) {
          return {
            where() {
              return {
                returning: async () => {
                  if (!allowUpdate) return []
                  stored = clone(value.result)
                  writes++
                  return [{ key: candidate.key }]
                },
              }
            },
          }
        },
      }
    },
    insert() {
      return {
        values(value: { result: InvoiceReceipt }) {
          return {
            onConflictDoUpdate: async () => {
              stored = clone(value.result)
              writes++
            },
          }
        },
      }
    },
    delete() {
      throw new Error('No integrity deletion')
    },
  } as unknown as FinancialTransaction
  return {
    tx,
    candidate,
    read: () => clone(stored),
    mutate: (f: (row: InvoiceReceipt) => void) => f(stored),
    cas: (value: boolean) => {
      allowUpdate = value
    },
    get writes() {
      return writes
    },
    mutateBasis: (f: (row: PeriodReceipt) => void) => f(basis),
    review: (now: number, observed = financialFingerprint(stored)) => {
      reads = 0
      return classifyFinancialDispatch(tx, candidate, observed, now)
    },
  }
}
describe('pre-claim dispatch integrity is deliberate bounded work', () => {
  it('does not reset an existing eight-failure cadence during the first integrity review', async () => {
    const f = integrityFixture()
    f.mutate((row) => {
      row.markers[0].failedAttempts = 8
    })
    expect((await f.review(1000)).status).toBe('classified')
    expect(f.read().dispatchIntegrity!.nextReviewAtMs).toBe(901000)
  })
  it('leaves an unreadable marker collection unresolved without inventing a settlement queue', async () => {
    const f = integrityFixture()
    f.mutate((row) => Object.assign(row, { markers: [null] }))
    expect((await f.review(1000)).status).toBe('unresolved')
    expect(f.read().markers).toEqual([null])
    expect(f.writes).toBe(0)
  })
  it('persists a review without changing original money, pending obligation or contact evidence', async () => {
    const f = integrityFixture()
    const before = f.read()
    const result = await f.review(1000)
    expect(result.status).toBe('classified')
    const after = f.read()
    const { dispatchIntegrity, dispatchAtMs: _due, ...original } = after
    const { dispatchAtMs: _originalDue, ...originalBefore } = before
    expect(original).toEqual(originalBefore)
    expect(dispatchIntegrity).toMatchObject({
      code: 'incomplete-contact',
      reviews: 1,
      firstObservedAtMs: 1000,
      reviewedAtMs: 1000,
    })
    expect(after.dispatchAtMs).toBeGreaterThan(1000)
  })
  it('records actual repeated reviews and retains the15-minute classification cadence after eight', async () => {
    const f = integrityFixture()
    let now = 1000
    for (let i = 1; i <= 9; i++) {
      expect((await f.review(now)).status).toBe('classified')
      const review = f.read().dispatchIntegrity!
      expect(review.reviews).toBe(i)
      if (i >= 8) expect(review.nextReviewAtMs - now).toBe(900_000)
      now = review.nextReviewAtMs
    }
    expect(f.read().markers[0].requestKey).toBe('partial-original-request')
    expect(f.read().invoiceObligationState).toBe('open')
  })
  it('does not renew a future review without eligible work', async () => {
    const f = integrityFixture()
    await f.review(1000)
    const before = f.read()
    expect((await f.review(1001)).status).toBe('stale')
    expect(f.read()).toEqual(before)
  })
  it('preserves changed observations and a lost exact row CAS', async () => {
    const f = integrityFixture()
    expect((await f.review(1000, financialFingerprint({ different: true }))).status).toBe('stale')
    f.cas(false)
    expect((await f.review(1000)).status).toBe('stale')
    expect(f.writes).toBe(0)
  })
  it.each(['owner', 'money', 'record'] as const)(
    'refuses unprovable original %s without writes',
    async (kind) => {
      const f = integrityFixture()
      f.mutate((row) => {
        if (kind === 'owner') row.root.id = 'wrong-owner'
        else if (kind === 'money') row.amountCents = '01'
        else row.requestKey = 'changed-original-intent'
      })
      expect((await f.review(1000)).status).toBe('unresolved')
      expect(f.writes).toBe(0)
    }
  )
  it('preserves a live current claim rather than overwriting a possible producer', async () => {
    const f = integrityFixture()
    f.mutate((row) =>
      Object.assign(row.markers[0], {
        state: 'claimed',
        claimId: 'active-original',
        claimExpiresAtMs: 2000,
        attempts: 1,
      })
    )
    expect((await f.review(1000)).status).toBe('busy')
    expect(f.writes).toBe(0)
  })
  it('never recovers unknown contact by erasing the original partial preparation', async () => {
    const f = integrityFixture()
    await f.review(1000)
    f.mutate((row) => {
      Reflect.deleteProperty(row.markers[0], 'requestKey')
    })
    const reviewAt = f.read().dispatchIntegrity!.nextReviewAtMs
    expect((await f.review(reviewAt)).status).toBe('classified')
    expect(f.read().dispatchIntegrity!.code).toBe('incomplete-contact')
    expect((await f.review(f.read().dispatchIntegrity!.nextReviewAtMs)).status).toBe('classified')
    expect(f.read().dispatchIntegrity!.code).toBe('incomplete-contact')
  })
  it('recovers a schedule-only fault only while original financial and contact facts remain identical', async () => {
    const f = integrityFixture()
    f.mutate((row) => {
      Reflect.deleteProperty(row.markers[0], 'requestKey')
      row.dispatchAtMs = -1
    })
    expect((await f.review(1000)).status).toBe('classified')
    expect((await f.review(f.read().dispatchIntegrity!.nextReviewAtMs)).status).toBe('recovered')
    expect(Object.hasOwn(f.read(), 'dispatchIntegrity')).toBe(false)
    expect(f.read().markers[0]).toMatchObject({ state: 'pending', phase: 'create' })
  })
  it('ordinary canonical writes cannot mint, alter or erase review protection', async () => {
    const f = integrityFixture()
    const original = f.read()
    original.dispatchIntegrity = {
      code: 'invalid-marker',
      observedFingerprint: financialFingerprint(original),
      evidenceFingerprint: financialFingerprint(original),
      reviews: 1,
      firstObservedAtMs: 1000,
      reviewedAtMs: 1000,
      nextReviewAtMs: 2000,
    }
    await expect(
      writeFinancialReceipt(f.tx, f.candidate.namespace, f.candidate.key, original)
    ).rejects.toThrow('canonical review')
    await f.review(1000)
    const protectedReceipt = f.read()
    const copy = f.read()
    Reflect.deleteProperty(copy, 'dispatchIntegrity')
    await writeFinancialReceipt(f.tx, f.candidate.namespace, f.candidate.key, copy)
    expect(f.read().dispatchIntegrity).toEqual(protectedReceipt.dispatchIntegrity)
    const changed = f.read()
    changed.dispatchIntegrity!.nextReviewAtMs++
    await expect(
      writeFinancialReceipt(f.tx, f.candidate.namespace, f.candidate.key, changed)
    ).rejects.toThrow('canonical review')
  })
  it('generic writers cannot mint protection by omitting the dispatch collection', async () => {
    const f = integrityFixture()
    const raw = f.read()
    Reflect.deleteProperty(raw, 'markers')
    Object.assign(raw, { dispatchIntegrity: { code: 'invalid-marker' } })
    await expect(
      writeFinancialReceipt(f.tx, f.candidate.namespace, f.candidate.key, raw)
    ).rejects.toThrow('canonical review')
    expect(f.writes).toBe(0)
  })
  it('does not prove a closed basis from a missing closing field', async () => {
    const f = integrityFixture()
    f.mutateBasis((basis) => {
      Reflect.deleteProperty(basis, 'closing')
    })
    expect((await f.review(1000)).status).toBe('unresolved')
    expect(f.writes).toBe(0)
  })
  it.each(['mode', 'frozenAt'] as const)(
    'does not prove closing with missing %s',
    async (field) => {
      const f = integrityFixture()
      f.mutateBasis((basis) => {
        basis.closing = {
          acceptedUsd: '20',
          copilotUsd: '0',
          memberUsd: {},
          allowanceUsd: '10',
          mode: 'user',
          frozenAt: '2026-01-02T00:00:00.000Z',
        }
        Reflect.deleteProperty(basis.closing, field)
      })
      expect((await f.review(1000)).status).toBe('unresolved')
      expect(f.writes).toBe(0)
    }
  )
  it('never claims an expired first marker while a second live owning claim exists', async () => {
    const f = invoiceDispatchFixture()
    f.mutate((row) => {
      row.markers.push({
        ...row.markers[0],
        id: 'second-live-head',
        claimId: 'second-live-claim',
        claimExpiresAtMs: 5000,
      })
    })
    await expect(claimFinancialDispatch(f.tx, f.candidate, 1000)).rejects.toBeInstanceOf(
      FinancialDispatchIntegrityError
    )
    expect(f.writes).toEqual([])
  })
  it.each(['dispatchAtMs', 'nextAtMs', 'claimExpiresAtMs'] as const)(
    'classifies %s outside the existing15-digit index codec',
    async (field) => {
      const f = invoiceDispatchFixture()
      f.mutate((row) => {
        if (field === 'dispatchAtMs') row.dispatchAtMs = 1_000_000_000_000_000
        else row.markers[0][field] = 1_000_000_000_000_000
      })
      try {
        await claimFinancialDispatch(f.tx, f.candidate, 1000)
        throw new Error('Expected typed scheduling refusal')
      } catch (error) {
        expect(error).toBeInstanceOf(FinancialDispatchIntegrityError)
        expect((error as FinancialDispatchIntegrityError).integrityCode).toBe('invalid-schedule')
      }
      expect(f.writes).toEqual([])
    }
  )
  it.each(['usage-evaluate', 'prepare'] as const)(
    'classifies invoice notification %s at the owning-record boundary',
    async (phase) => {
      const f = invoiceDispatchFixture({ kind: 'notification', phase })
      await expect(claimFinancialDispatch(f.tx, f.candidate, 1000)).rejects.toBeInstanceOf(
        FinancialDispatchIntegrityError
      )
      expect(f.writes).toEqual([])
    }
  )
  it('joins queued listing slots and starts no claim after another slot reports storage failure', async () => {
    let release!: (rows: unknown[]) => void
    const gate = new Promise<unknown[]>((yes) => {
      release = yes
    })
    let calls = 0
    let claims = 0
    let executed = 0
    let ended = false
    const store = {
      select: () => {
        const ordinal = calls++
        const q = {
          from: () => q,
          where: () => q,
          orderBy: () => q,
          limit: () => (ordinal === 0 ? Promise.reject(new Error('private-storage-detail')) : gate),
        }
        return q
      },
      transaction: async () => {
        claims++
        throw new Error('No claim after failure')
      },
    } as unknown as FinancialDatabase
    const work = drainFinancialDispatch(store, {
      execute: async () => {
        executed++
        return { outcome: 'complete' }
      },
    }).then(
      () => {
        ended = true
        return null
      },
      (error) => {
        ended = true
        return error
      }
    )
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(ended).toBe(false)
    release([{ namespace, key: 'genuine-queued-key', due: 0 }])
    expect((await work).message).toBe('Financial dispatch storage service is unavailable')
    expect(claims).toBe(0)
    expect(executed).toBe(0)
  })
  it('releases an already captured claim without contact after another slot reports storage failure', async () => {
    const f = invoiceDispatchFixture()
    let release!: (claim: DispatchClaim) => void
    const gate = new Promise<DispatchClaim>((yes) => {
      release = yes
    })
    let lists = 0
    let transactions = 0
    let effects = 0
    const candidates = [f.candidate, { ...f.candidate, key: 'other-owned-candidate' }]
    const store = {
      select: () => {
        const current = lists++
        const q = {
          from: () => q,
          where: () => q,
          orderBy: () => q,
          limit: async () => (current < 2 ? candidates : []),
        }
        return q
      },
      transaction: async (callback: (tx: FinancialTransaction) => Promise<unknown>) => {
        transactions++
        if (transactions === 1) return gate
        if (transactions === 2) throw new Error('private-storage-detail')
        return callback(f.tx)
      },
    } as unknown as FinancialDatabase
    const work = drainFinancialDispatch(store, {
      execute: async () => {
        effects++
        return { outcome: 'complete' }
      },
    }).then(
      () => null,
      (error) => error
    )
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(transactions).toBe(2)
    release(f.existingClaim())
    expect((await work).message).toBe('Financial dispatch storage service is unavailable')
    expect(effects).toBe(0)
    expect(f.read().markers[0].state).toBe('uncertain')
  })
  it('raw claim exposes a fixed typed integrity observation, not a recipient/provider payload', async () => {
    const f = invoiceDispatchFixture({ provider: 'stripe' })
    try {
      await claimFinancialDispatch(f.tx, f.candidate, 1000)
      throw new Error('Expected integrity refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(FinancialDispatchIntegrityError)
      const fault = error as FinancialDispatchIntegrityError
      expect(fault.integrityCode).toBe('incomplete-contact')
      expect(fault.observedFingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(fault.message).toBe('Financial dispatch evidence requires classification')
    }
    expect(f.writes).toEqual([])
  })
  it('drain fails sanitized after joining slots on an unexpected storage failure', async () => {
    let finished = 0
    const store = {
      select: () => {
        finished++
        throw new Error('private-provider-recipient-data')
      },
    } as unknown as FinancialDatabase
    await expect(
      drainFinancialDispatch(store, {
        execute: async () => {
          throw new Error('No contact')
        },
      })
    ).rejects.toThrow('storage service is unavailable')
    expect(finished).toBeGreaterThan(0)
  })
})

// Uses public SQL compilation to select the requested in-memory receipt, rather than a
// call-count script. This exercises policy decisions; actual locking/CAS is proved in PG.
function evaluationFixture() {
  const dialect = new PgDialect()
  const departed = 'unit-departed-member'
  const key = periodKey(originalPeriod)
  const ledger = {
    totalCost: '180',
    currentPeriodCost: '180',
    lastPeriodCost: '0',
    currentPeriodCopilotCost: '0',
    billedOverage: '0',
    blocked: false,
  }
  const targets = new Map([
    [actor, '80'],
    [departed, '100'],
  ])
  const memberships = [actor]
  const records = new Map<string, FinancialReceipt>()
  const basis: PeriodReceipt = {
    recordType: 'period',
    root,
    period: originalPeriod,
    commitments: { pendingUsd: '0', issuedUsd: '0' },
    closing: null,
    invoicePrefix: `invoice:${financialFingerprint(originalPeriod)}:`,
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: 0,
    markers: [
      {
        id: 'original-evaluation',
        kind: 'evaluate',
        phase: 'final',
        state: 'pending',
        attempts: 0,
        failedAttempts: 0,
        nextAtMs: 0,
      },
    ],
  }
  records.set(key, basis)
  records.set('period-head', {
    recordType: 'period-head',
    root,
    current: originalPeriod,
    previous: null,
    financialClosureState: 'open',
  })
  records.set('member-registry:v1', {
    recordType: 'member-registry',
    version: 1,
    root,
    financialClosureState: 'closed',
    provenance: {
      kind: 'live-root-creation',
      reference: `organization:${root.id}`,
      digest: financialFingerprint({ root, creation: 'actual-organization-insert', baseline: [] }),
      observedAt: at,
    },
  })
  for (const userId of targets.keys()) {
    const ledgerAnchor = financialFingerprint({ organizationId: root.id, userId })
    const actualMembershipId = `membership:${userId}`
    records.set(`member-registration:v1:${userId}`, {
      recordType: 'member-registration',
      version: 1,
      root,
      userId,
      ledgerAnchor,
      financialClosureState: 'closed',
      provenance: {
        kind: 'live-membership-registration',
        reference: `member:${actualMembershipId}`,
        digest: financialFingerprint({ root, userId, ledgerAnchor, actualMembershipId }),
        observedAt: at,
      },
    })
  }
  const locks: unknown[] = []
  const writes: FinancialReceipt[] = []
  let allowCas = true
  let beforeLock: (() => void) | undefined
  const tx = {
    execute: async () => {
      beforeLock?.()
      beforeLock = undefined
      return indexRows
    },
    select(selection?: Record<string, unknown>) {
      let table: unknown
      let clause: SQL | undefined
      let joined = false
      const query = {
        from(value: unknown) {
          table = value
          return query
        },
        where(value: SQL) {
          clause = value
          return query
        },
        limit() {
          return query
        },
        for() {
          locks.push(table)
          return query
        },
        orderBy() {
          return query
        },
        innerJoin() {
          joined = true
          return query
        },
        then(yes: (rows: unknown[]) => unknown, no: (error: unknown) => unknown) {
          try {
            const params = clause ? dialect.sqlToQuery(clause).params : []
            let rows: unknown[]
            if (table === tables.idempotencyKey) {
              if (selection?.key && selection.result)
                rows = [...records]
                  .filter(([, row]) => row.recordType === 'member-registration')
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, result]) => ({ key, result: clone(result) }))
              else if (selection?.result) {
                const requested = params.find(
                  (value) => typeof value === 'string' && value !== namespace
                )
                const result = records.get(String(requested))
                rows = result ? [{ result: clone(result) }] : []
              } else rows = []
            } else if (table === tables.organization) rows = [{ id: root.id }]
            else if (table === tables.organizationBillingLedger) rows = [clone(ledger)]
            else if (table === tables.organizationMemberBillingLedger)
              rows = [...targets].map(([id, cost]) => ({
                ...ledger,
                id,
                userId: id,
                cost,
                currentPeriodCost: cost,
              }))
            else if (table === tables.member) rows = memberships.map((id) => ({ id }))
            else if (table === tables.systemBillingSettings)
              rows = [{ overageThresholdDollars: '50' }]
            else if (table === tables.subscription) {
              const sub = {
                id: originalPeriod.subscriptionId,
                plan: 'unit-tier',
                billingTierId: 'unit-tier',
                referenceType: root.type,
                referenceId: root.id,
                stripeCustomerId: originalPeriod.customerId,
                stripeSubscriptionId: originalPeriod.stripeSubscriptionId,
                periodStart: new Date(originalPeriod.start!),
                periodEnd: new Date(originalPeriod.end!),
                seats: 3,
              }
              rows = joined
                ? [
                    {
                      sub,
                      tier: {
                        id: 'unit-tier',
                        ownerType: 'organization',
                        usageScope: 'individual',
                        isDefault: false,
                        includedUsageLimitUsd: '20',
                      },
                    },
                  ]
                : [sub]
            } else throw new Error('Unexpected evaluation fixture table')
            return Promise.resolve(rows).then(yes, no)
          } catch (error) {
            return Promise.reject(error).then(yes, no)
          }
        },
      }
      return query
    },
    insert(table: unknown) {
      if (table !== tables.idempotencyKey) throw new Error('No target creation')
      return {
        values(value: { key: string; result: FinancialReceipt }) {
          return {
            onConflictDoUpdate: async () => {
              records.set(value.key, clone(value.result))
              writes.push(clone(value.result))
            },
          }
        },
      }
    },
    update(table: unknown) {
      if (table !== tables.idempotencyKey) throw new Error('No ledger posting in evaluation')
      return {
        set(value: { result: FinancialReceipt }) {
          return {
            where(clause: SQL) {
              return {
                returning: async () => {
                  if (!allowCas) return []
                  const params = dialect.sqlToQuery(clause).params
                  const requested = params.find(
                    (value) => typeof value === 'string' && records.has(value)
                  )
                  const expected = params.find(
                    (value) => typeof value === 'string' && value.startsWith('{')
                  )
                  if (
                    typeof requested !== 'string' ||
                    typeof expected !== 'string' ||
                    financialFingerprint(records.get(requested)) !==
                      financialFingerprint(JSON.parse(expected))
                  )
                    return []
                  records.set(requested, clone(value.result))
                  writes.push(clone(value.result))
                  return [{ key: requested }]
                },
              }
            },
          }
        },
      }
    },
  } as unknown as FinancialTransaction
  return {
    tx,
    key,
    basis,
    records,
    targets,
    memberships,
    ledger,
    locks,
    writes,
    departed,
    candidate: { namespace, key, due: 0 },
    cas(value: boolean) {
      allowCas = value
    },
    duringLock(callback: () => void) {
      beforeLock = callback
    },
    review(now = 1000) {
      return classifyFinancialDispatch(
        tx,
        { namespace, key, due: 0 },
        financialFingerprint(records.get(key)),
        now
      )
    },
  }
}

describe('raw period evaluation preserves the complete original member basis', () => {
  it('includes the departed retained member and reserves the full140USD only once', async () => {
    const f = evaluationFixture()
    const invoice = await evaluateFinancialPeriod(f.tx, namespace, f.key, 'threshold')
    expect(invoice).toMatchObject({
      recordType: 'invoice',
      amountCents: '14000',
      root,
      period: originalPeriod,
    })
    expect(f.records.get(f.key)).toMatchObject({
      commitments: { pendingUsd: '140', issuedUsd: '0' },
    })
    expect(await evaluateFinancialPeriod(f.tx, namespace, f.key, 'threshold')).toBeNull()
    expect(f.locks.indexOf(tables.organizationMemberBillingLedger)).toBeLessThan(
      f.locks.indexOf(tables.idempotencyKey)
    )
  })
  it.each(['live', 'suspended', 'frozen'] as const)(
    'refuses missing retained targets on %s authority before a receipt lock or invoice',
    async (state) => {
      const f = evaluationFixture()
      if (state === 'suspended')
        f.basis.suspension = {
          allowanceUsd: '20',
          mode: 'individual',
          defaultGrant: false,
          capturedAt: at,
        }
      if (state === 'frozen')
        f.basis.closing = {
          acceptedUsd: '180',
          copilotUsd: '0',
          memberUsd: { [actor]: '80', [f.departed]: '100' },
          allowanceUsd: '20',
          mode: 'individual',
          frozenAt: at,
        }
      f.targets.delete(f.departed)
      const before = clone([...f.records])
      await expect(evaluateFinancialPeriod(f.tx, namespace, f.key, 'final')).rejects.toMatchObject({
        integrityCode: 'incomplete-member-basis',
      })
      expect(f.locks).not.toContain(tables.idempotencyKey)
      expect(f.writes).toEqual([])
      expect([...f.records]).toEqual(before)
    }
  )
  it('uses frozen money rather than current member amounts', async () => {
    const f = evaluationFixture()
    f.basis.closing = {
      acceptedUsd: '180',
      copilotUsd: '0',
      memberUsd: { [actor]: '80', [f.departed]: '100' },
      allowanceUsd: '20',
      mode: 'individual',
      frozenAt: at,
    }
    f.targets.set(actor, '999')
    expect(await evaluateFinancialPeriod(f.tx, namespace, f.key, 'final')).toMatchObject({
      amountCents: '14000',
    })
  })
  it.each(['namespace', 'key'] as const)(
    'refuses a foreign original %s before any owning lock',
    async (field) => {
      const f = evaluationFixture()
      await expect(
        evaluateFinancialPeriod(
          f.tx,
          field === 'namespace' ? `${namespace}-foreign` : namespace,
          field === 'key' ? 'period:foreign' : f.key,
          'final'
        )
      ).rejects.toThrow('target invalid')
      expect(f.locks).toEqual([])
      expect(f.writes).toEqual([])
    }
  )
  it('rereads immutable period identity after acquiring the original locks', async () => {
    const f = evaluationFixture()
    f.duringLock(() => {
      f.basis.period = { ...originalPeriod, subscriptionId: 'foreign-subscription' }
    })
    await expect(evaluateFinancialPeriod(f.tx, namespace, f.key, 'threshold')).rejects.toThrow(
      'period changed'
    )
    expect(f.writes).toEqual([])
  })
  it('preclaim refuses an incomplete evaluation and classifier retains exact evidence with bounded reviews', async () => {
    const f = evaluationFixture()
    f.targets.delete(f.departed)
    const original = clone(f.basis)
    await expect(claimFinancialDispatch(f.tx, f.candidate, 1000)).rejects.toMatchObject({
      integrityCode: 'incomplete-member-basis',
      observedFingerprint: financialFingerprint(original),
    })
    expect(f.writes).toEqual([])
    expect(await f.review()).toMatchObject({
      status: 'classified',
      code: 'incomplete-member-basis',
    })
    const classified = f.records.get(f.key) as PeriodReceipt
    expect(classified.markers).toEqual(original.markers)
    expect(classified.commitments).toEqual(original.commitments)
    const first = clone(classified.dispatchIntegrity!)
    // A merely complete row set is not proof that erased historical money was recovered.
    f.targets.set(f.departed, '0')
    expect(await f.review(first.nextReviewAtMs)).toMatchObject({
      status: 'classified',
      code: 'incomplete-member-basis',
    })
    expect((f.records.get(f.key) as PeriodReceipt).dispatchIntegrity).toMatchObject({
      evidenceFingerprint: first.evidenceFingerprint,
      firstObservedAtMs: first.firstObservedAtMs,
      reviews: 2,
    })
  })
  it('does not overwrite an existing nonrecoverable reason or the original evidence baseline', async () => {
    const f = evaluationFixture()
    f.basis.dispatchIntegrity = {
      code: 'incomplete-contact',
      observedFingerprint: financialFingerprint(f.basis),
      evidenceFingerprint: 'a'.repeat(64),
      reviews: 2,
      firstObservedAtMs: 1,
      reviewedAtMs: 2,
      nextReviewAtMs: 3,
    }
    f.targets.delete(f.departed)
    expect(await f.review()).toMatchObject({ status: 'classified', code: 'incomplete-contact' })
    expect((f.records.get(f.key) as PeriodReceipt).dispatchIntegrity).toMatchObject({
      evidenceFingerprint: 'a'.repeat(64),
      firstObservedAtMs: 1,
      code: 'incomplete-contact',
    })
  })
  it('leaves unprovable original registry/owner evidence unresolved without manufacturing a review', async () => {
    const f = evaluationFixture()
    f.records.set('period-head', {
      recordType: 'period-head',
      root: { type: 'organization', id: 'foreign' },
      current: originalPeriod,
      previous: null,
      financialClosureState: 'open',
    })
    f.targets.delete(f.departed)
    expect(await f.review()).toEqual({
      status: 'unresolved',
      reason: 'unprovable-financial-record',
    })
    expect(f.writes).toEqual([])
  })
  it('keeps failed classification CAS stale and preserves the original obligation', async () => {
    const f = evaluationFixture()
    f.targets.delete(f.departed)
    const before = clone([...f.records])
    f.cas(false)
    expect(await f.review()).toEqual({ status: 'stale' })
    expect([...f.records]).toEqual(before)
  })
})
