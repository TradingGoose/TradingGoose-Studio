import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { and, eq, gt, like, lte } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type ToolId, ToolResultSchemas } from '@/lib/copilot/registry'
import {
  assertAcceptedServerToolReviewBase,
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import {
  isServerToolReviewRejectedResult,
  serverToolReviewRejectedSchema,
} from '@/lib/copilot/tools/shared/review-result'
import { normalizeOptionalString } from '@/lib/utils'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'

const REVIEW_TOKEN_PREFIX = 'copilot-tool-review:'
const REVIEW_TOKEN_TTL_MS = 30 * 60 * 1000

type StagedServerToolReview = {
  userId?: unknown
  toolName?: unknown
  encryptedPayload?: unknown
  baseStateHash?: unknown
  nativeReviewBinding?: unknown
  executionContext?: Pick<
    ServerToolExecutionContext,
    'contextEntityKind' | 'contextEntityId' | 'workspaceId'
  >
}

function readBaseStateHash(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Server tool review result is missing base state')
  }

  const record = result as { reviewBaseStateHash?: unknown }
  if (typeof record.reviewBaseStateHash === 'string' && record.reviewBaseStateHash) {
    return record.reviewBaseStateHash
  }

  throw new Error('Server tool review result is missing base state')
}

async function deleteExpiredReviewTokens(now = new Date()) {
  await db
    .delete(verification)
    .where(
      and(
        like(verification.identifier, `${REVIEW_TOKEN_PREFIX}%`),
        lte(verification.expiresAt, now)
      )
    )
}

export async function stageServerManagedToolReview(
  toolName: ToolId,
  payload: unknown,
  result: unknown,
  context?: ServerToolExecutionContext
) {
  if (
    !result ||
    typeof result !== 'object' ||
    (result as { requiresReview?: unknown }).requiresReview !== true
  ) {
    return result
  }
  if (!context?.userId) {
    throw new Error('Authenticated user is required to stage server tool review')
  }

  const reviewToken = nanoid()
  const now = new Date()
  const { reviewBaseStateHash: _reviewBaseStateHash, ...publicResult } = result as Record<
    string,
    unknown
  >
  const { contextEntityKind, contextEntityId, workspaceId } = context
  const encryptedPayload = (await encryptSecret(JSON.stringify(payload ?? null))).encrypted
  await deleteExpiredReviewTokens(now)
  await db.insert(verification).values({
    id: nanoid(),
    identifier: `${REVIEW_TOKEN_PREFIX}${reviewToken}`,
    value: JSON.stringify({
      userId: context.userId,
      toolName,
      encryptedPayload,
      baseStateHash: readBaseStateHash(result),
      nativeReviewBinding: context.nativeReviewBinding,
      executionContext: { contextEntityKind, contextEntityId, workspaceId },
    }),
    expiresAt: new Date(now.getTime() + REVIEW_TOKEN_TTL_MS),
    createdAt: now,
    updatedAt: now,
  })

  return {
    ...publicResult,
    reviewToken,
  }
}

async function prepareServerManagedToolReview(
  toolName: ToolId,
  reviewToken: string,
  context?: ServerToolExecutionContext
) {
  if (!context?.userId) throw new Error('Authenticated user is required for a server tool review')
  throwIfServerToolAborted(context)
  await deleteExpiredReviewTokens()
  const identifier = `${REVIEW_TOKEN_PREFIX}${reviewToken}`
  const [row] = await db
    .select({ id: verification.id, value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1)
  if (!row || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt.getTime() <= Date.now())
    throw new Error('Server tool review token is invalid or expired')
  let staged: StagedServerToolReview
  try {
    staged = JSON.parse(row.value) as StagedServerToolReview
  } catch {
    throw new Error('Server tool review token is invalid or expired')
  }
  if (
    !staged ||
    staged.userId !== context.userId ||
    staged.toolName !== toolName ||
    typeof staged.baseStateHash !== 'string' ||
    !staged.baseStateHash ||
    staged.nativeReviewBinding !== context.nativeReviewBinding ||
    typeof staged.encryptedPayload !== 'string' ||
    !staged.encryptedPayload ||
    !staged.executionContext ||
    typeof staged.executionContext !== 'object' ||
    Array.isArray(staged.executionContext)
  )
    throw new Error('Server tool review token does not match this request')
  for (const field of ['workspaceId', 'contextEntityKind', 'contextEntityId'] as const) {
    const supplied = normalizeOptionalString(context[field])
    const original = normalizeOptionalString(staged.executionContext[field])
    if (supplied && supplied !== original)
      throw new Error(`${field} does not match execution context`)
  }
  const { decrypted } = await decryptSecret(staged.encryptedPayload)
  throwIfServerToolAborted(context)
  const payload = JSON.parse(decrypted)
  const executionContext = {
    ...staged.executionContext,
    userId: context.userId,
    signal: context.signal,
    nativeReviewBinding: context.nativeReviewBinding,
  }
  const currentReview = await routeExecution(toolName, payload, {
    ...executionContext,
    accessLevel: 'limited',
  })
  throwIfServerToolAborted(context)
  if (!currentReview || typeof currentReview !== 'object' || currentReview.requiresReview !== true)
    throw new Error('A genuine current server tool preview is required')
  assertAcceptedServerToolReviewBase(
    { ...executionContext, acceptedReviewBaseStateHash: staged.baseStateHash },
    readBaseStateHash(currentReview)
  )
  return { row, identifier, payload, executionContext, baseStateHash: staged.baseStateHash }
}

async function claimServerManagedToolReview(
  prepared: Awaited<ReturnType<typeof prepareServerManagedToolReview>>
) {
  throwIfServerToolAborted(prepared.executionContext)
  const claimValue = `claimed:${nanoid()}`
  const [claimedRow] = await db
    .update(verification)
    .set({ value: claimValue })
    .where(
      and(
        eq(verification.id, prepared.row.id),
        eq(verification.identifier, prepared.identifier),
        eq(verification.value, prepared.row.value),
        gt(verification.expiresAt, new Date())
      )
    )
    .returning({ id: verification.id })
  if (!claimedRow) throw new Error('Server tool review token is invalid or expired')
  return claimValue
}

async function consumeServerManagedToolReview(
  prepared: Awaited<ReturnType<typeof prepareServerManagedToolReview>>,
  claimValue: string
) {
  const [deletedRow] = await db
    .delete(verification)
    .where(
      and(
        eq(verification.id, prepared.row.id),
        eq(verification.identifier, prepared.identifier),
        eq(verification.value, claimValue)
      )
    )
    .returning({ id: verification.id })
  if (!deletedRow) throw new Error('Server tool review decision acknowledgement is unavailable')
}

export async function acceptServerManagedToolReview(
  toolName: ToolId,
  reviewToken: string,
  context?: ServerToolExecutionContext
) {
  const prepared = await prepareServerManagedToolReview(toolName, reviewToken, context)
  const claimValue = await claimServerManagedToolReview(prepared)
  // A rejected reply can follow an applied effect. Never restore a reusable token after dispatch.
  const result = await routeExecution(toolName, prepared.payload, {
    ...prepared.executionContext,
    accessLevel: 'full',
    acceptedReviewBaseStateHash: prepared.baseStateHash,
  })
  await consumeServerManagedToolReview(prepared, claimValue)
  return result
}

export async function rejectServerManagedToolReview(
  toolName: ToolId,
  reviewToken: string,
  context?: ServerToolExecutionContext
) {
  const prepared = await prepareServerManagedToolReview(toolName, reviewToken, context)
  const candidate = serverToolReviewRejectedSchema(toolName).parse({
    success: false,
    rejected: true,
    toolName,
  })
  const result = ToolResultSchemas[toolName].parse(candidate)
  if (!isServerToolReviewRejectedResult(toolName, result))
    throw new Error('This tool does not support a server preview rejection')
  const claimValue = await claimServerManagedToolReview(prepared)
  await consumeServerManagedToolReview(prepared, claimValue)
  return result
}
