import { createHash } from 'crypto'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type ToolId } from '@/lib/copilot/registry'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import {
  applyEncryptedEnvironmentVariablesForUser,
  buildEnvironmentVariablesReviewPayload,
} from '@/lib/copilot/tools/server/user/set-environment-variables'

const REVIEW_TOKEN_PREFIX = 'copilot-tool-review:'
const REVIEW_TOKEN_TTL_MS = 30 * 60 * 1000

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function readBaseSignature(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Server tool review result is missing base state')
  }

  const record = result as {
    preview?: { documentDiff?: { before?: unknown } }
    reviewBaseStateHash?: unknown
  }
  if (typeof record.reviewBaseStateHash === 'string' && record.reviewBaseStateHash) {
    return `state:${record.reviewBaseStateHash}`
  }
  const before = record.preview?.documentDiff?.before
  if (typeof before === 'string') {
    return `document:${hashValue(before)}`
  }

  throw new Error('Server tool review result is missing base state')
}

function stripReviewMetadata(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result
  }

  const { reviewBaseStateHash: _reviewBaseStateHash, ...publicResult } = result as Record<
    string,
    unknown
  >
  return publicResult
}

async function buildStagedReviewValue(
  toolName: ToolId,
  payload: unknown,
  result: unknown,
  context: ServerToolExecutionContext & { userId: string }
) {
  const staged: Record<string, unknown> = {
    userId: context.userId,
    toolName,
    payload,
    baseSignature: readBaseSignature(result),
  }

  if (toolName === 'set_environment_variables') {
    const reviewPayload = await buildEnvironmentVariablesReviewPayload(payload, context)
    staged.payload = reviewPayload.payload
    staged.encryptedEnvironmentVariables = reviewPayload.encryptedVariables
  }

  return staged
}

function readEncryptedEnvironmentVariables(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Server tool review token is invalid or expired')
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, encrypted]) => {
      if (typeof encrypted !== 'string') {
        throw new Error('Server tool review token is invalid or expired')
      }
      return [key, encrypted]
    })
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
  const publicResult = stripReviewMetadata(result)
  const stagedValue = await buildStagedReviewValue(toolName, payload, result, {
    ...context,
    userId: context.userId,
  })
  await db.insert(verification).values({
    id: nanoid(),
    identifier: `${REVIEW_TOKEN_PREFIX}${reviewToken}`,
    value: JSON.stringify(stagedValue),
    expiresAt: new Date(now.getTime() + REVIEW_TOKEN_TTL_MS),
    createdAt: now,
    updatedAt: now,
  })

  return {
    ...(publicResult as Record<string, unknown>),
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

  let staged: {
    userId?: unknown
    toolName?: unknown
    payload?: unknown
    baseSignature?: unknown
    encryptedEnvironmentVariables?: unknown
  }
  try {
    staged = JSON.parse(row.value) as {
      userId?: unknown
      toolName?: unknown
      payload?: unknown
      baseSignature?: unknown
      encryptedEnvironmentVariables?: unknown
    }
  } catch {
    throw new Error('Server tool review token is invalid or expired')
  }
  if (
    !staged ||
    staged.userId !== context.userId ||
    staged.toolName !== toolName ||
    typeof staged.baseSignature !== 'string'
  ) {
    throw new Error('Server tool review token does not match this request')
  }

  const currentReview = await routeExecution(toolName, staged.payload, {
    ...context,
    accessLevel: 'limited',
  })
  if (readBaseSignature(currentReview) !== staged.baseSignature) {
    throw new StructuredServerToolError({
      status: 409,
      body: {
        code: 'stale_server_tool_review',
        error: 'This reviewed Copilot edit is stale because the target changed after review.',
        hint: 'Ask Copilot to read the current target and prepare the edit again.',
        retryable: true,
      },
    })
  }

  const [deleted] = await db
    .delete(verification)
    .where(eq(verification.identifier, `${REVIEW_TOKEN_PREFIX}${reviewToken}`))
    .returning({ id: verification.id })
  if (!deleted) {
    throw new Error('Server tool review token is invalid or expired')
  }

  if (toolName === 'set_environment_variables') {
    return applyEncryptedEnvironmentVariablesForUser(
      context.userId,
      readEncryptedEnvironmentVariables(staged.encryptedEnvironmentVariables),
      context
    )
  }

  return routeExecution(toolName, staged.payload, {
    ...context,
    accessLevel: 'full',
  })
}
