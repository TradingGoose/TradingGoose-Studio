import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type ToolId, ToolResultSchemas } from '@/lib/copilot/registry'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import {
  acceptCustomToolDocumentReview,
  acceptIndicatorDocumentReview,
  acceptMcpServerDocumentReview,
  acceptSkillDocumentReview,
  acceptWorkflowDocumentReview,
} from '@/lib/copilot/tools/server/entities'
import { acceptKnowledgeBaseDocumentReview } from '@/lib/copilot/tools/server/knowledge/knowledge-base'

const REVIEW_TOKEN_PREFIX = 'copilot-tool-review:'
const REVIEW_TOKEN_TTL_MS = 30 * 60 * 1000

export async function stageServerManagedToolReview(
  toolName: ToolId,
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
  await db.insert(verification).values({
    id: nanoid(),
    identifier: `${REVIEW_TOKEN_PREFIX}${reviewToken}`,
    value: JSON.stringify({
      userId: context.userId,
      toolName,
      result,
    }),
    expiresAt: new Date(now.getTime() + REVIEW_TOKEN_TTL_MS),
    createdAt: now,
    updatedAt: now,
  })

  return {
    ...result,
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

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: verification.id,
        value: verification.value,
        expiresAt: verification.expiresAt,
      })
      .from(verification)
      .where(eq(verification.identifier, `${REVIEW_TOKEN_PREFIX}${reviewToken}`))
      .for('update')
      .limit(1)

    if (!row || row.expiresAt <= new Date()) {
      throw new Error('Server tool review token is invalid or expired')
    }

    let staged: { userId?: unknown; toolName?: unknown; result?: unknown }
    try {
      staged = JSON.parse(row.value) as { userId?: unknown; toolName?: unknown; result?: unknown }
    } catch {
      throw new Error('Server tool review token is invalid or expired')
    }
    if (!staged || staged.userId !== context.userId || staged.toolName !== toolName) {
      throw new Error('Server tool review token does not match this request')
    }

    const parsedResult = ToolResultSchemas[toolName].parse(staged.result)
    const result = await applyServerManagedToolReview(toolName, parsedResult, context)
    await tx.delete(verification).where(eq(verification.id, row.id))
    return result
  })
}

function applyServerManagedToolReview(
  toolName: ToolId,
  parsedResult: unknown,
  context?: ServerToolExecutionContext
) {
  switch (toolName) {
    case 'edit_workflow':
    case 'edit_workflow_block':
    case 'edit_workflow_variable':
      return acceptWorkflowDocumentReview(toolName, parsedResult, context)
    case 'create_skill':
    case 'edit_skill':
    case 'rename_skill':
      return acceptSkillDocumentReview(toolName, parsedResult, context)
    case 'create_custom_tool':
    case 'edit_custom_tool':
    case 'rename_custom_tool':
      return acceptCustomToolDocumentReview(toolName, parsedResult, context)
    case 'create_indicator':
    case 'edit_indicator':
    case 'rename_indicator':
      return acceptIndicatorDocumentReview(toolName, parsedResult, context)
    case 'create_knowledge_base':
    case 'edit_knowledge_base':
    case 'rename_knowledge_base':
      return acceptKnowledgeBaseDocumentReview(toolName, parsedResult, context)
    case 'create_mcp_server':
    case 'edit_mcp_server':
    case 'rename_mcp_server':
      return acceptMcpServerDocumentReview(toolName, parsedResult, context)
    default:
      throw new Error(`Server tool ${toolName} does not support review acceptance`)
  }
}
