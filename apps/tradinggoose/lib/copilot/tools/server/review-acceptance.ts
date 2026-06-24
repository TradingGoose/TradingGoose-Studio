import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ToolId } from '@/lib/copilot/registry'
import {
  assertAcceptedServerToolReviewBase,
  type ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { createLogger } from '@/lib/logs/console/logger'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'

const REVIEW_TOKEN_PREFIX = 'copilot-tool-review:'
const REVIEW_TOKEN_TTL_MS = 30 * 60 * 1000
const logger = createLogger('ServerToolReviewAcceptance')

type StagedServerToolReview = {
  userId?: unknown
  toolName?: unknown
  encryptedPayload?: unknown
  baseStateHash?: unknown
  executionContext?: Pick<ServerToolExecutionContext, 'contextEntityKind' | 'contextEntityId' | 'workspaceId'>
  reviewClaimId?: unknown
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
  await db.insert(verification).values({
    id: nanoid(),
    identifier: `${REVIEW_TOKEN_PREFIX}${reviewToken}`,
    value: JSON.stringify({
      userId: context.userId,
      toolName,
      encryptedPayload,
      baseStateHash: readBaseStateHash(result),
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

export async function acceptServerManagedToolReview(
  toolName: ToolId,
  reviewToken: string,
  context?: ServerToolExecutionContext
) {
  if (!context?.userId) {
    throw new Error('Authenticated user is required to accept server tool review')
  }

  const [row] = await db
    .select({
      value: verification.value,
      expiresAt: verification.expiresAt,
    })
    .from(verification)
    .where(eq(verification.identifier, `${REVIEW_TOKEN_PREFIX}${reviewToken}`))
    .limit(1)

  if (!row || row.expiresAt <= new Date()) {
    throw new Error('Server tool review token is invalid or expired')
  }

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
    typeof staged.baseStateHash !== 'string'
  ) {
    throw new Error('Server tool review token does not match this request')
  }

  if (typeof staged.encryptedPayload !== 'string' || !staged.encryptedPayload) {
    throw new Error('Server tool review token is invalid or expired')
  }
  if (!staged.executionContext || typeof staged.executionContext !== 'object') {
    throw new Error('Server tool review token does not match this request')
  }
  if (typeof staged.reviewClaimId === 'string') {
    throw new Error('Server tool review token is already being accepted')
  }

  const { decrypted } = await decryptSecret(staged.encryptedPayload)
  const payload = JSON.parse(decrypted)
  const executionContext = {
    ...staged.executionContext,
    userId: context.userId,
    signal: context.signal,
  }
  const currentReview = await routeExecution(toolName, payload, {
    ...executionContext,
    accessLevel: 'limited',
  })
  assertAcceptedServerToolReviewBase(
    { ...executionContext, acceptedReviewBaseStateHash: staged.baseStateHash },
    readBaseStateHash(currentReview)
  )

  const identifier = `${REVIEW_TOKEN_PREFIX}${reviewToken}`
  const claimed = { ...staged, reviewClaimId: nanoid() }
  const claimedValue = JSON.stringify(claimed)
  const [claimedRow] = await db
    .update(verification)
    .set({ value: claimedValue, updatedAt: new Date() })
    .where(and(eq(verification.identifier, identifier), eq(verification.value, row.value)))
    .returning({ id: verification.id })
  if (!claimedRow) {
    throw new Error('Server tool review token is invalid or expired')
  }

  let acceptedResult: unknown
  try {
    acceptedResult = await routeExecution(toolName, payload, {
      ...executionContext,
      accessLevel: 'full',
      acceptedReviewBaseStateHash: staged.baseStateHash,
    })
  } catch (error) {
    await db
      .update(verification)
      .set({ value: row.value, updatedAt: new Date() })
      .where(and(eq(verification.identifier, identifier), eq(verification.value, claimedValue)))
      .catch((restoreError) => {
        logger.warn('Failed to restore server tool review token after acceptance failure', {
          error: restoreError,
          toolName,
        })
      })
    throw error
  }

  await db
    .delete(verification)
    .where(and(eq(verification.identifier, identifier), eq(verification.value, claimedValue)))
    .catch((error) => {
      logger.warn('Failed to delete accepted server tool review token', { error, toolName })
    })
  return acceptedResult
}
