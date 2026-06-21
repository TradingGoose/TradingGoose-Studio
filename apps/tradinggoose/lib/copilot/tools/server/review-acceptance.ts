import { createHash } from 'crypto'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  MCP_SERVER_DOCUMENT_FORMAT,
  parseEntityDocument,
  serializeEntityDocumentForReview,
} from '@/lib/copilot/entity-documents'
import { type ToolId } from '@/lib/copilot/registry'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'

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

function redactMcpServerReviewDocument(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  if (!value) {
    return ''
  }

  return serializeEntityDocumentForReview('mcp_server', parseEntityDocument('mcp_server', value))
}

function redactReviewSecrets(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result
  }

  const record = result as Record<string, unknown>
  if (
    record.entityKind !== 'mcp_server' &&
    record.documentFormat !== MCP_SERVER_DOCUMENT_FORMAT
  ) {
    return result
  }

  const publicResult: Record<string, unknown> = { ...record }
  publicResult.entityDocument = redactMcpServerReviewDocument(publicResult.entityDocument)
  const preview = record.preview
  if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
    const documentDiff = (preview as { documentDiff?: unknown }).documentDiff
    if (documentDiff && typeof documentDiff === 'object' && !Array.isArray(documentDiff)) {
      publicResult.preview = {
        ...preview,
        documentDiff: {
          ...(documentDiff as Record<string, unknown>),
          before: redactMcpServerReviewDocument(
            (documentDiff as { before?: unknown }).before
          ),
          after: redactMcpServerReviewDocument((documentDiff as { after?: unknown }).after),
        },
      }
    }
  }

  return publicResult
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
  const encryptedPayload = (await encryptSecret(JSON.stringify(payload ?? null))).encrypted
  await db.insert(verification).values({
    id: nanoid(),
    identifier: `${REVIEW_TOKEN_PREFIX}${reviewToken}`,
    value: JSON.stringify({
      userId: context.userId,
      toolName,
      encryptedPayload,
      baseSignature: readBaseSignature(result),
    }),
    expiresAt: new Date(now.getTime() + REVIEW_TOKEN_TTL_MS),
    createdAt: now,
    updatedAt: now,
  })

  return {
    ...(redactReviewSecrets(publicResult) as Record<string, unknown>),
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
    encryptedPayload?: unknown
    baseSignature?: unknown
  }
  try {
    staged = JSON.parse(row.value) as {
      userId?: unknown
      toolName?: unknown
      encryptedPayload?: unknown
      baseSignature?: unknown
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

  if (typeof staged.encryptedPayload !== 'string' || !staged.encryptedPayload) {
    throw new Error('Server tool review token is invalid or expired')
  }

  const { decrypted } = await decryptSecret(staged.encryptedPayload)
  const payload = JSON.parse(decrypted)
  const currentReview = await routeExecution(toolName, payload, {
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

  const acceptedResult = await routeExecution(toolName, payload, {
    ...context,
    accessLevel: 'full',
  })
  return redactReviewSecrets(acceptedResult)
}
