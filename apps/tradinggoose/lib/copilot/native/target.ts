import { NativeTargetError } from './errors'

export { NativeTargetError } from './errors'

import { verifyFinancialAcceptance } from '@/lib/billing/native-finance'
import { isToolId } from '@/lib/copilot/registry'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { readNativeCopilot } from './client'
import { COPILOT_NATIVE_REVISION, type Pending, type Scope, type Target } from './contract'
import { nativeConversationIdentity } from './identity'

export async function authorizeNativeConversationScope(
  actorUserId: string,
  workspaceId: string | null
): Promise<Scope> {
  if (!actorUserId.trim())
    throw new NativeTargetError('Authenticated Copilot actor is required', 401)
  if (workspaceId !== null) {
    if (!workspaceId.trim()) throw new NativeTargetError('Invalid conversation workspace', 422)
    if (!(await checkWorkspaceAccess(workspaceId, actorUserId)).hasAccess) {
      throw new NativeTargetError('Conversation workspace access denied', 403)
    }
  }
  return { actorUserId, workspaceId }
}

export function assertOriginalBusinessArguments(originalArgs: unknown) {
  if (!originalArgs || typeof originalArgs !== 'object' || Array.isArray(originalArgs)) {
    throw new NativeTargetError('Original business arguments must be a decoded object', 422)
  }
  const prototype = Object.getPrototypeOf(originalArgs)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NativeTargetError('Original business arguments must be plain JSON', 422)
  }
  for (const key of ['resumeData', 'suspendedToolCallId', 'suspendedToolRunId', '_background']) {
    if (key in originalArgs)
      throw new NativeTargetError('Native execution fields cannot be business arguments', 422)
  }
}

type NativeFinancialSource = Readonly<{
  scope: Readonly<Scope>
  target: Readonly<Target>
  binding: Readonly<Pending['financialBinding']>
  occurrence: Readonly<Pending['financialOccurrence']>
  originalArgsJson: string
  pendingJson: string
  acceptanceJson: string
  signal?: AbortSignal
}>
const NATIVE_FINANCIAL_SOURCE = Symbol('verified-native-pending-financial-source')

/** JSON properties and inherited lookalikes never supply original financial provenance. */
export function getNativeFinancialSource(value: unknown): NativeFinancialSource | undefined {
  return value && typeof value === 'object' && Object.hasOwn(value, NATIVE_FINANCIAL_SOURCE)
    ? (value as Record<symbol, NativeFinancialSource>)[NATIVE_FINANCIAL_SOURCE]
    : undefined
}

/** Copy only the exact source minted by fresh target/receipt verification below. */
export function copyNativeFinancialSource<T extends object>(from: unknown, to: T): T {
  const source = getNativeFinancialSource(from)
  if (!source) return to
  const existing = getNativeFinancialSource(to)
  if (existing && existing !== source)
    throw new NativeTargetError('Conflicting original native financial provenance', 403)
  if (!existing)
    Object.defineProperty(to, NATIVE_FINANCIAL_SOURCE, { value: source, enumerable: false })
  return to
}

/** Identifiers are lookups. Only fresh service pending evidence plus original receipt can authorize an action. */
export async function resolveNativePendingTarget(
  scope: Scope,
  target: Target,
  stage: Pending['stage'],
  signal?: AbortSignal
): Promise<Pending> {
  if (
    !isToolId(target.toolName) ||
    target.resourceId !== nativeConversationIdentity(scope).resourceId
  ) {
    throw new NativeTargetError('Native target does not belong to this conversation scope', 403)
  }
  let match: Pending | undefined
  const seen = new Set<string>()
  let page = 0
  while (true) {
    signal?.throwIfAborted()
    const requestedPage = { page, perPage: 100 }
    const { result, status } = await readNativeCopilot(
      {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: crypto.randomUUID(),
        command: 'pending.list',
        scope,
        threadId: target.threadId,
        page: requestedPage,
      },
      signal
    )
    if (status !== 200 || result.status !== 'pending_targets') {
      throw new NativeTargetError(
        'Native pending target could not be verified',
        status >= 400 ? status : 503
      )
    }
    if (
      result.page.page !== page ||
      result.page.perPage !== 100 ||
      result.items.length > 100 ||
      (result.hasMore && result.items.length === 0)
    ) {
      throw new NativeTargetError('Native pending target pagination is inconsistent', 503)
    }
    for (const pending of result.items) {
      const identity = stableStringifyJsonValue(pending.target)
      if (
        seen.has(identity) ||
        pending.target.threadId !== target.threadId ||
        pending.target.resourceId !== target.resourceId ||
        !isToolId(pending.target.toolName)
      )
        throw new NativeTargetError('Native pending list contains an inconsistent target', 503)
      seen.add(identity)
      if (identity !== stableStringifyJsonValue(target)) continue
      if (match) throw new NativeTargetError('Native target is ambiguous')
      match = pending
    }
    if (!result.hasMore) break
    page += 1
    if (!Number.isSafeInteger(page))
      throw new NativeTargetError('Native pending pagination overflow', 503)
  }
  if (!match || match.stage !== stage)
    throw new NativeTargetError('Native target is stale or at the wrong suspension stage')
  const binding = match.financialBinding
  if (
    binding.actorUserId !== scope.actorUserId ||
    binding.workspaceId !== scope.workspaceId ||
    binding.runId !== target.runId ||
    binding.purpose !== 'copilot' ||
    (match.financialOccurrence.runId !== undefined &&
      match.financialOccurrence.runId !== target.runId)
  ) {
    throw new NativeTargetError('Native target original financial scope does not match', 403)
  }
  const acceptance = await verifyFinancialAcceptance(binding, match.financialOccurrence)
  signal?.throwIfAborted()
  assertOriginalBusinessArguments(match.originalArgs)
  const verified = { ...match }
  const source: NativeFinancialSource = Object.freeze({
    scope: Object.freeze({ ...scope }),
    target: Object.freeze({ ...match.target }),
    binding: Object.freeze({ ...binding }),
    occurrence: Object.freeze({ ...match.financialOccurrence }),
    originalArgsJson: stableStringifyJsonValue(match.originalArgs),
    pendingJson: stableStringifyJsonValue(match),
    acceptanceJson: stableStringifyJsonValue(acceptance),
    signal,
  })
  Object.defineProperty(verified, NATIVE_FINANCIAL_SOURCE, { value: source, enumerable: false })
  return verified
}
