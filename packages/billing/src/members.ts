import {
  idempotencyKey,
  member,
  organization,
  organizationBillingLedger,
  organizationMemberBillingLedger,
  user,
} from '@tradinggoose/db/schema'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import {
  assertFinancialStorageReady,
  FinancialPolicyError,
  type FinancialRoot,
  type FinancialTransaction,
  financialFingerprint,
  financialNamespace,
  lockFinancialRoots,
  readFinancialReceipt,
  writeFinancialReceipt,
} from './index'
import { monetary } from './money'

export type FinancialMemberProvenance = {
  kind: 'live-root-creation' | 'live-membership-registration' | 'verified-preservation'
  reference: string
  digest: string
  observedAt: string
}
export type MemberRegistryReceipt = {
  recordType: 'member-registry'
  version: 1
  root: FinancialRoot & { type: 'organization' }
  provenance: FinancialMemberProvenance
  financialClosureState: 'closed'
}
export type MemberRegistrationReceipt = Omit<MemberRegistryReceipt, 'recordType'> & {
  recordType: 'member-registration'
  userId: string
  ledgerAnchor: string
}
export type FinancialMembership = {
  id: string
  organizationId: string
  userId: string
  role: string
  createdAt: Date
}
export const memberRegistryKey = 'member-registry:v1'
export const memberRegistrationKey = (userId: string) => {
  if (typeof userId !== 'string' || !userId || userId.length > 512)
    throw new FinancialPolicyError('Invalid original financial member')
  return `member-registration:v1:${userId}`
}
export const memberRegistrationPredicate = sql`${idempotencyKey.namespace} LIKE 'billing-usage:%' AND ${idempotencyKey.result}->>'recordType' = 'member-registration'`
const rootOf = (id: string) => ({ type: 'organization' as const, id })
const anchorOf = (organizationId: string, userId: string) =>
  financialFingerprint({ organizationId, userId })
function refuse(message: string): never {
  throw new FinancialPolicyError(message)
}
const serialized = (row: unknown) => JSON.parse(JSON.stringify(row))
export function validateFinancialLedger(row: Record<string, unknown>) {
  for (const [field, value] of Object.entries(row)) {
    if (
      field.endsWith('Cost') ||
      field === 'billedOverageThisPeriod' ||
      field === 'billedOverage'
    ) {
      try {
        monetary(value)
      } catch {
        refuse('Original financial ledger money is invalid')
      }
    } else if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
      refuse('Original financial ledger counter is invalid')
    if ((field === 'billingBlocked' || field === 'blocked') && typeof value !== 'boolean')
      refuse('Original financial ledger blocked state is invalid')
    if (['lastActive', 'createdAt', 'updatedAt'].includes(field)) {
      if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        refuse('Original financial ledger timestamp is invalid')
    }
  }
}
function verifyFreshLedger(row: Record<string, unknown> | undefined) {
  if (!row) refuse('Fresh financial ledger readback failed')
  validateFinancialLedger(row)
  for (const field of [
    'totalCost',
    'currentPeriodCost',
    'lastPeriodCost',
    'totalCopilotCost',
    'currentPeriodCopilotCost',
    'lastPeriodCopilotCost',
  ])
    if (monetary(row[field]) !== '0') refuse('Fresh financial ledger contains unexpected money')
  for (const field of [
    'totalManualExecutions',
    'totalApiCalls',
    'totalWebhookTriggers',
    'totalScheduledExecutions',
    'totalChatExecutions',
    'totalTokensUsed',
    'totalCopilotTokens',
    'totalCopilotCalls',
  ])
    if (row[field] !== 0) refuse('Fresh financial ledger contains unexpected counters')
  for (const [field, value] of Object.entries(row)) {
    if ((field.endsWith('Cost') || field === 'billedOverageThisPeriod') && monetary(value) !== '0')
      refuse('Fresh financial ledger contains unexpected money')
    if (typeof value === 'number' && value !== 0)
      refuse('Fresh financial ledger contains unexpected counters')
    if (field === 'billingBlocked' && value !== false)
      refuse('Fresh financial ledger has an unexpected blocked state')
  }
}

export function validateFinancialMemberReceipt(
  receipt: MemberRegistryReceipt | MemberRegistrationReceipt,
  namespace: string,
  key: string
) {
  const provenance = receipt.provenance
  if (
    receipt.version !== 1 ||
    receipt.root?.type !== 'organization' ||
    financialNamespace(receipt.root) !== namespace ||
    receipt.financialClosureState !== 'closed' ||
    !provenance ||
    typeof provenance.reference !== 'string' ||
    !provenance.reference ||
    provenance.reference.length > 1024 ||
    !/^[a-f0-9]{64}$/.test(provenance.digest) ||
    typeof provenance.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(provenance.observedAt)) ||
    new Date(provenance.observedAt).toISOString() !== provenance.observedAt ||
    ![
      receipt.recordType === 'member-registry'
        ? 'live-root-creation'
        : 'live-membership-registration',
      'verified-preservation',
    ].includes(provenance.kind)
  )
    refuse('Financial member provenance is missing or malformed')
  if (receipt.recordType === 'member-registry') {
    if (key !== memberRegistryKey) refuse('Financial registry identity conflicts')
    if (
      provenance.kind === 'live-root-creation' &&
      (provenance.reference !== `organization:${receipt.root.id}` ||
        provenance.digest !==
          financialFingerprint({
            root: receipt.root,
            creation: 'actual-organization-insert',
            baseline: [],
          }))
    )
      refuse('Original financial registry creation provenance conflicts')
  } else if (
    key !== memberRegistrationKey(receipt.userId) ||
    receipt.ledgerAnchor !== anchorOf(receipt.root.id, receipt.userId)
  )
    refuse('Original financial member ledger anchor conflicts')
  if (
    receipt.recordType === 'member-registration' &&
    provenance.kind === 'live-membership-registration'
  ) {
    const membershipId = provenance.reference.startsWith('member:')
      ? provenance.reference.slice('member:'.length)
      : ''
    if (
      !membershipId ||
      provenance.digest !==
        financialFingerprint({
          root: receipt.root,
          userId: receipt.userId,
          ledgerAnchor: receipt.ledgerAnchor,
          actualMembershipId: membershipId,
        })
    )
      refuse('Original financial member insertion provenance conflicts')
  }
}
async function registry(tx: FinancialTransaction, organizationId: string) {
  await requireOrganizationLedger(tx, organizationId)
  const row = await readFinancialReceipt(
    tx,
    financialNamespace(rootOf(organizationId)),
    memberRegistryKey
  )
  if (!row || row.recordType !== 'member-registry')
    refuse('Verified complete financial member registry required')
  return row
}
async function requireOrganizationLedger(tx: FinancialTransaction, organizationId: string) {
  const [target] = await tx
    .select()
    .from(organizationBillingLedger)
    .where(eq(organizationBillingLedger.organizationId, organizationId))
    .limit(1)
  if (!target) refuse('Original financial organization ledger is missing; preservation required')
  validateFinancialLedger(target)
}
async function pairState(tx: FinancialTransaction, organizationId: string, userId: string) {
  const pair = await readFinancialReceipt(
    tx,
    financialNamespace(rootOf(organizationId)),
    memberRegistrationKey(userId)
  )
  const [ledger] = await tx
    .select()
    .from(organizationMemberBillingLedger)
    .where(
      and(
        eq(organizationMemberBillingLedger.organizationId, organizationId),
        eq(organizationMemberBillingLedger.userId, userId)
      )
    )
    .limit(1)
  if (pair && pair.recordType !== 'member-registration')
    refuse('Original financial member registration conflicts')
  if (Boolean(pair) !== Boolean(ledger))
    refuse('Original financial member registration/ledger is missing; preservation required')
  if (ledger) validateFinancialLedger(ledger)
  if (pair && (pair.root.id !== organizationId || pair.userId !== userId))
    refuse('Original financial member pair conflicts')
  return { pair, ledger }
}

/** Actual creation is enclosed by this transaction; callback results never prove freshness. */
export async function initializeFinancialMemberRegistry<T>(
  tx: FinancialTransaction,
  organizationId: string,
  actualCreateOrganization: () => Promise<T>
): Promise<T> {
  const root = rootOf(organizationId)
  const namespace = financialNamespace(root)
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(4126093::bigint)`)
  await assertFinancialStorageReady(tx)
  const [priorRoot] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  const [priorEvidence] = await tx
    .select({ key: idempotencyKey.key })
    .from(idempotencyKey)
    .where(eq(idempotencyKey.namespace, namespace))
    .limit(1)
  if (priorRoot || priorEvidence) refuse('Financial organization identity is not genuinely new')
  const result = await actualCreateOrganization()
  await lockFinancialRoots(tx, [root])
  const [evidence] = await tx
    .select({ key: idempotencyKey.key })
    .from(idempotencyKey)
    .where(eq(idempotencyKey.namespace, namespace))
    .limit(1)
  const [priorLedger] = await tx
    .select()
    .from(organizationBillingLedger)
    .where(eq(organizationBillingLedger.organizationId, organizationId))
    .limit(1)
  const [priorMember] = await tx
    .select({ id: member.id })
    .from(member)
    .where(eq(member.organizationId, organizationId))
    .limit(1)
  const [priorTarget] = await tx
    .select({ id: organizationMemberBillingLedger.userId })
    .from(organizationMemberBillingLedger)
    .where(eq(organizationMemberBillingLedger.organizationId, organizationId))
    .limit(1)
  if (evidence || priorLedger || priorMember || priorTarget)
    refuse('New financial root has unexpected prior targets or evidence')
  await tx.insert(organizationBillingLedger).values({ organizationId })
  const [created] = await tx
    .select()
    .from(organizationBillingLedger)
    .where(eq(organizationBillingLedger.organizationId, organizationId))
    .limit(1)
  verifyFreshLedger(created)
  await writeFinancialReceipt(tx, namespace, memberRegistryKey, {
    recordType: 'member-registry',
    version: 1,
    root,
    financialClosureState: 'closed',
    provenance: {
      kind: 'live-root-creation',
      reference: `organization:${organizationId}`,
      digest: financialFingerprint({ root, creation: 'actual-organization-insert', baseline: [] }),
      observedAt: new Date().toISOString(),
    },
  })
  return result
}

/** Genuine live registration only; callers retain their fresh actor/invitation/capacity gates. */
export async function registerFinancialMember(
  tx: FinancialTransaction,
  input: { organizationId: string; userId: string },
  actualInsertMembership: () => Promise<unknown>
): Promise<FinancialMembership> {
  const { organizationId, userId } = input
  const root = rootOf(organizationId)
  memberRegistrationKey(userId)
  await lockFinancialRoots(tx, [root, { type: 'user', id: userId }])
  await registry(tx, organizationId)
  const [existingUser] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!existingUser) refuse('Original financial member user is missing')
  const state = await pairState(tx, organizationId, userId)
  const before = await tx
    .select()
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
  if (before.length > 1 || (before.length && !state.pair))
    refuse('Existing membership has no verified financial target')
  if (before.length) return before[0]
  await actualInsertMembership()
  const after = await tx
    .select()
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
  if (after.length !== 1) refuse('Actual membership insertion readback failed')
  if (!state.pair) {
    await tx.insert(organizationMemberBillingLedger).values({ organizationId, userId })
    const [ledger] = await tx
      .select()
      .from(organizationMemberBillingLedger)
      .where(
        and(
          eq(organizationMemberBillingLedger.organizationId, organizationId),
          eq(organizationMemberBillingLedger.userId, userId)
        )
      )
      .limit(1)
    verifyFreshLedger(ledger)
    const ledgerAnchor = anchorOf(organizationId, userId)
    await writeFinancialReceipt(tx, financialNamespace(root), memberRegistrationKey(userId), {
      recordType: 'member-registration',
      version: 1,
      root,
      userId,
      ledgerAnchor,
      financialClosureState: 'closed',
      provenance: {
        kind: 'live-membership-registration',
        reference: `member:${after[0].id}`,
        digest: financialFingerprint({
          root,
          userId,
          ledgerAnchor,
          actualMembershipId: after[0].id,
        }),
        observedAt: new Date().toISOString(),
      },
    })
  }
  await readFinancialMemberTarget(tx, organizationId, userId)
  return after[0]
}

export async function readFinancialMemberTarget(
  tx: FinancialTransaction,
  organizationId: string,
  userId: string
): Promise<void> {
  await lockFinancialRoots(tx, [rootOf(organizationId)])
  await registry(tx, organizationId)
  const state = await pairState(tx, organizationId, userId)
  if (!state.pair || !state.ledger) refuse('Original financial member target is unregistered')
}
export async function listFinancialMemberRegistrations(
  tx: FinancialTransaction,
  organizationId: string,
  options: { after?: string; limit?: number } = {}
): Promise<MemberRegistrationReceipt[]> {
  const namespace = financialNamespace(rootOf(organizationId))
  const limit = options.limit ?? 100
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    (options.after !== undefined && !options.after.startsWith('member-registration:v1:'))
  )
    refuse('Invalid financial member registration cursor/limit')
  const rows = await tx
    .select({ key: idempotencyKey.key, result: idempotencyKey.result })
    .from(idempotencyKey)
    .where(
      and(
        memberRegistrationPredicate,
        eq(idempotencyKey.namespace, namespace),
        options.after ? gt(idempotencyKey.key, options.after) : undefined
      )
    )
    .orderBy(asc(idempotencyKey.key))
    .limit(Math.min(limit, 100))
  return rows.map(({ key, result }) => {
    const receipt = result as MemberRegistrationReceipt
    validateFinancialMemberReceipt(receipt, namespace, key)
    return receipt
  })
}
export async function assertFinancialMemberTargets(
  tx: FinancialTransaction,
  organizationId: string
): Promise<void> {
  await lockFinancialRoots(tx, [rootOf(organizationId)])
  await registry(tx, organizationId)
  const registered = new Set<string>()
  let after: string | undefined
  for (;;) {
    const page = await listFinancialMemberRegistrations(tx, organizationId, { after })
    for (const receipt of page) {
      if (registered.has(receipt.userId)) refuse('Duplicate original financial member anchor')
      registered.add(receipt.userId)
    }
    if (page.length < 100) break
    after = memberRegistrationKey(page[page.length - 1].userId)
  }
  const targets = await tx
    .select({ id: organizationMemberBillingLedger.userId })
    .from(organizationMemberBillingLedger)
    .where(eq(organizationMemberBillingLedger.organizationId, organizationId))
  if (targets.length !== registered.size || targets.some(({ id }) => !registered.has(id)))
    refuse('Registered financial member targets are incomplete or conflicting')
  const current = await tx
    .select({ id: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  if (new Set(current.map(({ id }) => id)).size !== current.length)
    refuse('Current financial membership identity is duplicated')
  if (current.some(({ id }) => !registered.has(id)))
    refuse('Current membership has no registered original financial target')
}

/** Internal no-head deletion classification only. Never creates or repairs financial evidence. */
export async function assertPristineFinancialOrganization(
  tx: FinancialTransaction,
  organizationId: string
): Promise<void> {
  await assertFinancialMemberTargets(tx, organizationId)
  const root = rootOf(organizationId)
  const namespace = financialNamespace(root)
  const coverage = await registry(tx, organizationId)
  const exactKeys = (value: object, keys: string[]) =>
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort())
  let after: string | undefined
  let registries = 0
  for (;;) {
    const rows = await tx
      .select({ key: idempotencyKey.key, result: idempotencyKey.result })
      .from(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.namespace, namespace),
          after ? gt(idempotencyKey.key, after) : undefined
        )
      )
      .orderBy(asc(idempotencyKey.key))
      .limit(100)
    for (const { key, result } of rows) {
      if (
        !result ||
        typeof result !== 'object' ||
        Array.isArray(result) ||
        !['member-registry', 'member-registration'].includes(
          (result as { recordType: string }).recordType
        )
      )
        refuse('Financial history without a period head requires classified recovery')
      const receipt = result as MemberRegistryReceipt | MemberRegistrationReceipt
      validateFinancialMemberReceipt(receipt, namespace, key)
      if (
        !exactKeys(receipt, [
          'recordType',
          'version',
          'root',
          'provenance',
          'financialClosureState',
          ...(receipt.recordType === 'member-registration' ? ['userId', 'ledgerAnchor'] : []),
        ]) ||
        !exactKeys(receipt.root, ['type', 'id']) ||
        !exactKeys(receipt.provenance, ['kind', 'reference', 'digest', 'observedAt'])
      )
        refuse('Pristine financial provenance contains unclassified evidence')
      if (receipt.recordType === 'member-registry') registries++
      else if (
        receipt.provenance.kind === 'verified-preservation' &&
        (coverage.provenance.kind !== 'verified-preservation' ||
          receipt.provenance.reference !== coverage.provenance.reference ||
          receipt.provenance.digest !==
            financialFingerprint({
              registryDigest: coverage.provenance.digest,
              userId: receipt.userId,
              ledgerAnchor: receipt.ledgerAnchor,
            }))
      )
        refuse('Pristine preserved member provenance conflicts with complete registry')
    }
    if (rows.length < 100) break
    after = rows[rows.length - 1].key
  }
  if (registries !== 1) refuse('Complete pristine financial registry is missing or conflicting')
  const [owner] = await tx
    .select()
    .from(organizationBillingLedger)
    .where(eq(organizationBillingLedger.organizationId, organizationId))
    .limit(1)
  verifyFreshLedger(owner)
  if (monetary(owner.billedOverageThisPeriod) !== '0' || owner.billingBlocked !== false)
    refuse('Original financial organization has unpaid or blocked obligations')
  const targets = await tx
    .select()
    .from(organizationMemberBillingLedger)
    .where(eq(organizationMemberBillingLedger.organizationId, organizationId))
  for (const target of targets) verifyFreshLedger(target)
}

export type FinancialMemberPreservationLedger = {
  organizationId: string
  userId: string
  [column: string]: string | number | null
}
/** Offline verified preservation only. No runtime reader or mutation calls this operation. */
export async function preserveFinancialMemberRegistry(
  tx: FinancialTransaction,
  input: {
    organizationId: string
    sourceReference: string
    sourceDigest: string
    expectedLedgers: FinancialMemberPreservationLedger[]
  }
): Promise<{ verifiedPairs: number; registryDigest: string }> {
  const { organizationId, sourceReference, sourceDigest } = input
  const root = rootOf(organizationId)
  const namespace = financialNamespace(root)
  if (!sourceReference || sourceReference.length > 1024 || !/^[a-f0-9]{64}$/.test(sourceDigest))
    refuse('Verified preservation source reference/digest required')
  await lockFinancialRoots(tx, [root])
  await requireOrganizationLedger(tx, organizationId)
  const expected = new Map<string, FinancialMemberPreservationLedger>()
  for (const row of input.expectedLedgers) {
    memberRegistrationKey(row.userId)
    if (row.organizationId !== organizationId || expected.has(row.userId))
      refuse('Preservation ledger source identity conflicts')
    expected.set(row.userId, row)
  }
  const targets = await tx
    .select()
    .from(organizationMemberBillingLedger)
    .where(eq(organizationMemberBillingLedger.organizationId, organizationId))
    .orderBy(asc(organizationMemberBillingLedger.userId))
  const identities = new Set(targets.map((row) => row.userId))
  const memberships = await tx
    .select({ id: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  for (const row of memberships) identities.add(row.id)
  for (const id of expected.keys()) identities.add(id)
  let after: string | undefined
  for (;;) {
    const rows = await tx
      .select({ key: idempotencyKey.key, result: idempotencyKey.result })
      .from(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.namespace, namespace),
          after ? gt(idempotencyKey.key, after) : undefined
        )
      )
      .orderBy(asc(idempotencyKey.key))
      .limit(100)
    for (const { key, result } of rows) {
      const row = result as Record<string, any>
      if (row.recordType === 'invocation' || row.recordType === 'operation') {
        if (!row.identity || financialNamespace(row.identity.root) !== namespace)
          refuse('Preservation original operation identity is malformed')
        if (row.identity.memberUserId !== null) {
          memberRegistrationKey(row.identity.memberUserId)
          identities.add(row.identity.memberUserId)
        }
        memberRegistrationKey(row.identity.actorUserId)
        identities.add(row.identity.actorUserId)
      } else if (row.recordType === 'period') {
        if (financialNamespace(row.root) !== namespace)
          refuse('Preservation closing owner conflicts')
        if (row.closing) {
          if (
            !row.closing.memberUsd ||
            typeof row.closing.memberUsd !== 'object' ||
            Array.isArray(row.closing.memberUsd)
          )
            refuse('Preservation closing member basis is malformed')
          for (const [id, amount] of Object.entries(row.closing.memberUsd)) {
            memberRegistrationKey(id)
            if (monetary(amount) !== amount) refuse('Preservation closing money is not exact')
            identities.add(id)
          }
        }
      } else if (row.recordType === 'member-registry' || row.recordType === 'member-registration') {
        validateFinancialMemberReceipt(
          row as MemberRegistryReceipt | MemberRegistrationReceipt,
          namespace,
          key
        )
        if (row.recordType === 'member-registration') identities.add(row.userId)
      } else if (!['period-head', 'invoice', 'notification'].includes(row.recordType))
        refuse('Unknown preservation financial record requires classification')
    }
    if (rows.length < 100) break
    after = rows[rows.length - 1].key
  }
  if (identities.size !== targets.length || identities.size !== expected.size)
    refuse('Complete preservation includes a missing original financial target')
  for (const row of targets) {
    validateFinancialLedger(row)
    const evidence = expected.get(row.userId)
    if (!evidence || financialFingerprint(serialized(row)) !== financialFingerprint(evidence))
      refuse('Authoritative preserved member ledger money/counters/settings differ')
  }
  const registryDigest = financialFingerprint({
    root,
    sourceReference,
    sourceDigest,
    targets: targets.map(serialized),
    memberIds: [...identities].sort(),
  })
  const oldRegistry = await readFinancialReceipt(tx, namespace, memberRegistryKey)
  if (oldRegistry) {
    if (
      oldRegistry.recordType !== 'member-registry' ||
      oldRegistry.provenance.kind !== 'verified-preservation' ||
      oldRegistry.provenance.digest !== registryDigest
    )
      refuse('Existing complete member coverage cannot be overwritten')
    await assertFinancialMemberTargets(tx, organizationId)
    return { verifiedPairs: identities.size, registryDigest }
  }
  const observedAt = new Date().toISOString()
  for (const userId of [...identities].sort()) {
    const prior = await readFinancialReceipt(tx, namespace, memberRegistrationKey(userId))
    if (prior) {
      if (prior.recordType !== 'member-registration' || prior.userId !== userId)
        refuse('Preserved member pair conflicts')
      continue
    }
    const ledgerAnchor = anchorOf(organizationId, userId)
    await writeFinancialReceipt(tx, namespace, memberRegistrationKey(userId), {
      recordType: 'member-registration',
      version: 1,
      root,
      userId,
      ledgerAnchor,
      financialClosureState: 'closed',
      provenance: {
        kind: 'verified-preservation',
        reference: sourceReference,
        digest: financialFingerprint({ registryDigest, userId, ledgerAnchor }),
        observedAt,
      },
    })
  }
  await writeFinancialReceipt(tx, namespace, memberRegistryKey, {
    recordType: 'member-registry',
    version: 1,
    root,
    financialClosureState: 'closed',
    provenance: {
      kind: 'verified-preservation',
      reference: sourceReference,
      digest: registryDigest,
      observedAt,
    },
  })
  await assertFinancialMemberTargets(tx, organizationId)
  return { verifiedPairs: identities.size, registryDigest }
}
