import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { CopilotRequest } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { type CopilotRun, copilotThreadOwnerId } from './ownership'

// Durable admission, cancellation and effect receipts prevent replay after interruption.
const receiptId = (kind: string, key: unknown) =>
  `copilot:${kind}:${createHash('sha256').update(stableStringifyJsonValue(key)).digest('hex')}`
const expiresAt = new Date('9999-12-31T00:00:00.000Z')

async function insertReceipt(
  id: string,
  identifier: string,
  value = 'true',
  store: Pick<typeof db, 'insert'> = db
) {
  const now = new Date()
  const rows = await store
    .insert(verification)
    .values({
      id,
      identifier,
      value,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: verification.id })
    .returning({ id: verification.id })
  return rows.length === 1
}

type ScopedRun = Pick<CopilotRun, 'runId' | 'threadId' | 'scope'>

const runOwner = (run: ScopedRun) => copilotThreadOwnerId(run.scope, run.threadId)

export async function readCopilotAdmission(
  run: ScopedRun,
  request: CopilotRequest & { requestId: string }
) {
  const [receipt] = await db
    .select({ identifier: verification.identifier, value: verification.value })
    .from(verification)
    .where(eq(verification.id, receiptId('admission', [run.scope, request.requestId])))
    .limit(1)
  if (!receipt) return false
  if (receipt.identifier !== runOwner(run) || receipt.value !== receiptId('request', request))
    throw new NativeTargetError('This Copilot request ID already belongs to another command', 409)
  return true
}

export async function claimCopilotAdmission(
  run: ScopedRun,
  request: CopilotRequest & { requestId: string }
) {
  if (
    !(await insertReceipt(
      receiptId('admission', [run.scope, request.requestId]),
      runOwner(run),
      receiptId('request', request)
    ))
  )
    throw new NativeTargetError('This Copilot request was already admitted', 409)
}

export async function cancelCopilotRun(run: ScopedRun) {
  await insertReceipt(receiptId('cancel', run.runId), runOwner(run))
}

export async function assertCopilotRunActive(runId: string) {
  if (await isCopilotRunCancelled(runId))
    throw new NativeTargetError('Copilot generation was cancelled; completed effects remain', 409)
}

export async function isCopilotRunCancelled(runId: string) {
  const [row] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(eq(verification.id, receiptId('cancel', runId)))
    .limit(1)
  return Boolean(row)
}

/** Mastra stores outcomes. This claim prevents repeating an effect after an uncertain interruption. */
export async function claimCopilotEffect(
  run: ScopedRun,
  toolCallId: string,
  phase: 'execute' | 'review' | 'browser',
  store: Pick<typeof db, 'insert'> = db
) {
  if (
    !(await insertReceipt(
      receiptId('effect', [run.runId, toolCallId, phase]),
      runOwner(run),
      'true',
      store
    ))
  )
    throw new NativeTargetError(
      'This Copilot action was already dispatched; verify its result before continuing',
      409
    )
  await assertCopilotRunActive(run.runId)
}
