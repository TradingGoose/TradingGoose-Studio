import type { FinancialBinding, ModelOccurrence } from '@tradinggoose/billing'
import { NativeTargetError } from './errors'

export { NativeTargetError } from './errors'

import { verifyFinancialAcceptance } from '@/lib/billing/native-finance'
import { listCopilotPending } from '@/lib/copilot/agent/service'
import { isToolId } from '@/lib/copilot/registry'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import type { Pending, Scope, Target } from './contract'
import { nativeConversationIdentity } from './identity'

/** Original billing provenance stays on the server, outside product events/browser state. */
export type ServerPending = Pending & {
  financialBinding: FinancialBinding
  financialOccurrence: ModelOccurrence
}

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
  binding: Readonly<FinancialBinding>
  occurrence: Readonly<ModelOccurrence>
  originalArgsJson: string
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

/** Native snapshots supply pending work; browser identifiers only select it. */
export async function resolveNativePendingTarget(
  scope: Scope,
  target: Target,
  stage: Pending['stage'],
  signal?: AbortSignal
): Promise<ServerPending> {
  await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  if (
    !isToolId(target.toolName) ||
    target.resourceId !== nativeConversationIdentity(scope).resourceId
  )
    throw new NativeTargetError('Copilot target does not belong to this conversation scope', 403)
  const items = await listCopilotPending(scope, target.threadId, signal)
  const match = items.find(
    (pending) => stableStringifyJsonValue(pending.target) === stableStringifyJsonValue(target)
  )
  if (!match || match.stage !== stage)
    throw new NativeTargetError('Copilot target is stale or at the wrong suspension stage', 409)
  return verifyCopilotPendingSource(scope, match, signal)
}

/** Mint local financial provenance after authorization and canonical acceptance. */
export async function verifyCopilotPendingSource(
  scope: Scope,
  pending: ServerPending,
  signal?: AbortSignal
): Promise<ServerPending> {
  const binding = pending.financialBinding
  const target = pending.target
  if (
    binding.actorUserId !== scope.actorUserId ||
    binding.workspaceId !== scope.workspaceId ||
    binding.runId !== target.runId ||
    binding.purpose !== 'copilot' ||
    (pending.financialOccurrence.runId !== undefined &&
      pending.financialOccurrence.runId !== target.runId)
  )
    throw new NativeTargetError('Copilot target original financial scope does not match', 403)
  await verifyFinancialAcceptance(binding, pending.financialOccurrence)
  signal?.throwIfAborted()
  assertOriginalBusinessArguments(pending.originalArgs)
  const verified = { ...pending }
  const source: NativeFinancialSource = Object.freeze({
    scope: Object.freeze({ ...scope }),
    target: Object.freeze({ ...target }),
    binding: Object.freeze({ ...binding }),
    occurrence: Object.freeze({ ...pending.financialOccurrence }),
    originalArgsJson: stableStringifyJsonValue(pending.originalArgs),
    signal,
  })
  Object.defineProperty(verified, NATIVE_FINANCIAL_SOURCE, { value: source, enumerable: false })
  return verified
}
