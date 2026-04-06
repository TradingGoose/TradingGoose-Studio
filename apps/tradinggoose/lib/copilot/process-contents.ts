import { db } from '@tradinggoose/db'
import {
  copilotReviewItems,
  copilotReviewSessions,
  document,
  knowledgeBase,
  templates,
} from '@tradinggoose/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { REVIEW_ITEM_KINDS } from '@/lib/copilot/review-sessions/thread-history'
import { createLogger } from '@/lib/logs/console/logger'
import { escapeRegExp } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'
import type { ChatContext } from '@/stores/copilot/types'

export type AgentContextType =
  | 'past_chat'
  | 'workflow'
  | 'current_workflow'
  | 'skill'
  | 'current_skill'
  | 'indicator'
  | 'current_indicator'
  | 'custom_tool'
  | 'current_custom_tool'
  | 'mcp_server'
  | 'current_mcp_server'
  | 'blocks'
  | 'logs'
  | 'knowledge'
  | 'templates'
  | 'workflow_block'
  | 'docs'

export interface AgentContext {
  type: AgentContextType
  tag: string
  content: string
}

const logger = createLogger('ProcessContents')

// Server-side variant (recommended for use in API routes)
export async function processContextsServer(
  contexts: ChatContext[] | undefined,
  userId: string,
  userMessage?: string,
  workspaceId?: string
): Promise<AgentContext[]> {
  if (!Array.isArray(contexts) || contexts.length === 0) return []
  const tasks = contexts.map(async (ctx) => {
    try {
      if (ctx.kind === 'past_chat' && ctx.reviewSessionId) {
        return await processPastChatFromDb(
          ctx.reviewSessionId,
          userId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if ((ctx.kind === 'workflow' || ctx.kind === 'current_workflow') && ctx.workflowId) {
        return await processWorkflowFromDb(
          ctx.workflowId,
          ctx.label ? `@${ctx.label}` : '@',
          ctx.kind
        )
      }
      if ((ctx.kind === 'skill' || ctx.kind === 'current_skill') && ctx.skillId) {
        return await processEntityContextFromDb({
          contextKind: ctx.kind,
          entityKind: 'skill',
          entityId: ctx.skillId,
          workspaceId: resolveContextWorkspaceId(ctx.workspaceId, workspaceId, ctx),
          tag: ctx.label ? `@${ctx.label}` : '@',
        })
      }
      if ((ctx.kind === 'indicator' || ctx.kind === 'current_indicator') && ctx.indicatorId) {
        return await processEntityContextFromDb({
          contextKind: ctx.kind,
          entityKind: 'indicator',
          entityId: ctx.indicatorId,
          workspaceId: resolveContextWorkspaceId(ctx.workspaceId, workspaceId, ctx),
          tag: ctx.label ? `@${ctx.label}` : '@',
        })
      }
      if ((ctx.kind === 'custom_tool' || ctx.kind === 'current_custom_tool') && ctx.customToolId) {
        return await processEntityContextFromDb({
          contextKind: ctx.kind,
          entityKind: 'custom_tool',
          entityId: ctx.customToolId,
          workspaceId: resolveContextWorkspaceId(ctx.workspaceId, workspaceId, ctx),
          tag: ctx.label ? `@${ctx.label}` : '@',
        })
      }
      if ((ctx.kind === 'mcp_server' || ctx.kind === 'current_mcp_server') && ctx.mcpServerId) {
        return await processEntityContextFromDb({
          contextKind: ctx.kind,
          entityKind: 'mcp_server',
          entityId: ctx.mcpServerId,
          workspaceId: resolveContextWorkspaceId(ctx.workspaceId, workspaceId, ctx),
          tag: ctx.label ? `@${ctx.label}` : '@',
        })
      }
      if (ctx.kind === 'knowledge' && (ctx as any).knowledgeId) {
        return await processKnowledgeFromDb(
          (ctx as any).knowledgeId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if (ctx.kind === 'blocks' && ctx.blockIds.length > 0) {
        return await processBlocksMetadata(ctx.blockIds, ctx.label ? `@${ctx.label}` : '@')
      }
      if (ctx.kind === 'templates' && (ctx as any).templateId) {
        return await processTemplateFromDb(
          (ctx as any).templateId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if (ctx.kind === 'logs' && (ctx as any).executionId) {
        return await processExecutionLogFromDb(
          (ctx as any).executionId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if (ctx.kind === 'workflow_block' && ctx.workflowId && ctx.blockId) {
        return await processWorkflowBlockFromDb(ctx.workflowId, ctx.blockId, ctx.label)
      }
      if (ctx.kind === 'docs') {
        try {
          const { searchDocumentationServerTool } = await import(
            '@/lib/copilot/tools/server/docs/search-documentation'
          )
          const rawQuery = (userMessage || '').trim() || ctx.label || 'TradingGoose Documentation'
          const query = sanitizeMessageForDocs(rawQuery, contexts)
          const res = await searchDocumentationServerTool.execute({ query, topK: 10 })
          const content = JSON.stringify(res?.results || [])
          return { type: 'docs', tag: ctx.label ? `@${ctx.label}` : '@', content }
        } catch (e) {
          logger.error('Failed to process docs context', e)
          return null
        }
      }
      return null
    } catch (error) {
      logger.error('Failed processing context (server)', { ctx, error })
      return null
    }
  })
  const results = await Promise.all(tasks)
  const filtered = results.filter(
    (r): r is AgentContext => !!r && typeof r.content === 'string' && r.content.trim().length > 0
  )
  logger.info('Processed contexts (server)', {
    totalRequested: contexts.length,
    totalProcessed: filtered.length,
    kinds: Array.from(filtered.reduce((s, r) => s.add(r.type), new Set<string>())),
  })
  return filtered
}

function resolveContextWorkspaceId(
  contextWorkspaceId: string | undefined,
  fallbackWorkspaceId: string | undefined,
  context: ChatContext
): string | null {
  const resolvedWorkspaceId = contextWorkspaceId ?? fallbackWorkspaceId ?? null
  if (!resolvedWorkspaceId) {
    logger.warn('Skipping copilot entity context without workspaceId', {
      kind: context.kind,
      label: context.label,
    })
  }
  return resolvedWorkspaceId
}

async function processEntityContextFromDb(params: {
  contextKind:
    | 'skill'
    | 'current_skill'
    | 'indicator'
    | 'current_indicator'
    | 'custom_tool'
    | 'current_custom_tool'
    | 'mcp_server'
    | 'current_mcp_server'
  entityKind: 'skill' | 'indicator' | 'custom_tool' | 'mcp_server'
  entityId: string
  workspaceId: string | null
  tag: string
}): Promise<AgentContext | null> {
  if (!params.workspaceId) {
    return null
  }

  try {
    const { loadCustomTool, loadIndicator, loadMcpServer, loadSkill } = await import(
      '@/lib/copilot/review-sessions/entity-loaders'
    )

    let row: Record<string, unknown> | null = null
    switch (params.entityKind) {
      case 'skill':
        row = await loadSkill(params.entityId, params.workspaceId)
        break
      case 'indicator':
        row = await loadIndicator(params.entityId, params.workspaceId)
        break
      case 'custom_tool':
        row = await loadCustomTool(params.entityId, params.workspaceId)
        break
      case 'mcp_server':
        row = await loadMcpServer(params.entityId, params.workspaceId)
        break
    }

    if (!row) {
      logger.warn('No entity data found for copilot context', {
        entityKind: params.entityKind,
        entityId: params.entityId,
        workspaceId: params.workspaceId,
      })
      return null
    }

    return {
      type: params.contextKind,
      tag: params.tag,
      content: JSON.stringify(serializeEntityContext(params.entityKind, row), null, 2),
    }
  } catch (error) {
    logger.error('Error processing entity context', {
      entityKind: params.entityKind,
      entityId: params.entityId,
      workspaceId: params.workspaceId,
      error,
    })
    return null
  }
}

function serializeEntityContext(
  entityKind: 'skill' | 'indicator' | 'custom_tool' | 'mcp_server',
  row: Record<string, unknown>
) {
  switch (entityKind) {
    case 'skill':
      return {
        id: row.id ?? null,
        workspaceId: row.workspaceId ?? null,
        name: row.name ?? null,
        description: row.description ?? null,
        content: row.content ?? null,
      }
    case 'indicator':
      return {
        id: row.id ?? null,
        workspaceId: row.workspaceId ?? null,
        name: row.name ?? null,
        color: row.color ?? null,
        pineCode: row.pineCode ?? null,
        inputMeta: row.inputMeta ?? null,
      }
    case 'custom_tool':
      return {
        id: row.id ?? null,
        workspaceId: row.workspaceId ?? null,
        title: row.title ?? null,
        schema: row.schema ?? null,
        code: row.code ?? null,
      }
    case 'mcp_server':
      return {
        id: row.id ?? null,
        workspaceId: row.workspaceId ?? null,
        name: row.name ?? null,
        description: row.description ?? null,
        transport: row.transport ?? null,
        url: row.url ?? null,
        command: row.command ?? null,
        args: Array.isArray(row.args) ? row.args : [],
        headerKeys:
          row.headers && typeof row.headers === 'object'
            ? Object.keys(row.headers as Record<string, unknown>)
            : [],
        envKeys:
          row.env && typeof row.env === 'object'
            ? Object.keys(row.env as Record<string, unknown>)
            : [],
        timeout: row.timeout ?? null,
        retries: row.retries ?? null,
        enabled: row.enabled ?? null,
      }
  }
}

function sanitizeMessageForDocs(rawMessage: string, contexts: ChatContext[] | undefined): string {
  if (!rawMessage) return ''
  if (!Array.isArray(contexts) || contexts.length === 0) {
    // No context mapping; conservatively strip all @mentions-like tokens
    const stripped = rawMessage
      .replace(/(^|\s)@([^\s]+)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return stripped
  }

  // Gather labels by kind
  const blockLabels = new Set(
    contexts
      .filter((c) => c.kind === 'blocks')
      .map((c) => c.label)
      .filter((l): l is string => typeof l === 'string' && l.length > 0)
  )
  const nonBlockLabels = new Set(
    contexts
      .filter((c) => c.kind !== 'blocks')
      .map((c) => c.label)
      .filter((l): l is string => typeof l === 'string' && l.length > 0)
  )

  let result = rawMessage

  // 1) Remove all non-block mentions entirely
  for (const label of nonBlockLabels) {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(label)}(?!\\S)`, 'g')
    result = result.replace(pattern, ' ')
  }

  // 2) For block mentions, strip the '@' but keep the block name
  for (const label of blockLabels) {
    const pattern = new RegExp(`@${escapeRegExp(label)}(?!\\S)`, 'g')
    result = result.replace(pattern, label)
  }

  // 3) Remove any remaining @mentions (unknown or not in contexts)
  result = result.replace(/(^|\s)@([^\s]+)/g, ' ')

  // Normalize whitespace
  result = result.replace(/\s{2,}/g, ' ').trim()
  return result
}

async function processPastChatFromDb(
  reviewSessionId: string,
  userId: string,
  tag: string
): Promise<AgentContext | null> {
  try {
    // Run ownership check and message load in parallel since they are independent
    const [sessionRows, messageRows] = await Promise.all([
      db
        .select({ id: copilotReviewSessions.id })
        .from(copilotReviewSessions)
        .where(
          and(
            eq(copilotReviewSessions.id, reviewSessionId),
            eq(copilotReviewSessions.userId, userId)
          )
        )
        .limit(1),
      db
        .select({
          role: copilotReviewItems.messageRole,
          content: copilotReviewItems.content,
          contentBlocks: copilotReviewItems.contentBlocks,
        })
        .from(copilotReviewItems)
        .where(
          and(
            eq(copilotReviewItems.sessionId, reviewSessionId),
            eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
          )
        )
        .orderBy(asc(copilotReviewItems.sequence)),
    ])

    if (!sessionRows.length) {
      logger.warn('Past chat review session not found or not owned by user', {
        reviewSessionId,
        userId,
      })
      return null
    }

    const content = messageRows
      .map((m) => {
        const role = m.role || 'user'
        let text = ''
        if (Array.isArray(m.contentBlocks) && (m.contentBlocks as any[]).length > 0) {
          text = (m.contentBlocks as any[])
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => String(b.content || ''))
            .join('')
            .trim()
        }
        if (!text && typeof m.content === 'string') text = m.content
        return `${role}: ${text}`.trim()
      })
      .filter((s: string) => s.length > 0)
      .join('\n')

    logger.info('Processed past_chat context from DB', {
      reviewSessionId,
      length: content.length,
      lines: content ? content.split('\n').length : 0,
    })
    return { type: 'past_chat', tag, content }
  } catch (error) {
    logger.error('Error processing past chat from db', { reviewSessionId, error })
    return null
  }
}

async function processWorkflowFromDb(
  workflowId: string,
  tag: string,
  kind: 'workflow' | 'current_workflow' = 'workflow'
): Promise<AgentContext | null> {
  try {
    const normalized = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalized) {
      logger.warn('No normalized workflow data found', { workflowId })
      return null
    }
    const workflowState = {
      blocks: normalized.blocks || {},
      edges: normalized.edges || [],
      loops: normalized.loops || {},
      parallels: normalized.parallels || {},
    }
    // Sanitize workflow state for copilot (remove UI-specific data like positions)
    const sanitizedState = sanitizeForCopilot(workflowState)
    // Match get-user-workflow format: just the workflow state JSON
    const content = JSON.stringify(sanitizedState, null, 2)
    logger.info('Processed sanitized workflow context', {
      workflowId,
      blocks: Object.keys(sanitizedState.blocks || {}).length,
    })
    // Use the provided kind for the type
    return { type: kind, tag, content }
  } catch (error) {
    logger.error('Error processing workflow context', { workflowId, error })
    return null
  }
}

async function processKnowledgeFromDb(
  knowledgeBaseId: string,
  tag: string
): Promise<AgentContext | null> {
  try {
    // Load KB metadata
    const kbRows = await db
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        updatedAt: knowledgeBase.updatedAt,
      })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .limit(1)
    const kb = kbRows?.[0]
    if (!kb) return null

    // Load up to 20 recent doc filenames
    const docRows = await db
      .select({ filename: document.filename })
      .from(document)
      .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), isNull(document.deletedAt)))
      .limit(20)

    const sampleDocuments = docRows.map((d: any) => d.filename).filter(Boolean)
    // We don't have total via this quick select; fallback to sample count
    const summary = {
      id: kb.id,
      name: kb.name,
      docCount: sampleDocuments.length,
      sampleDocuments,
    }
    const content = JSON.stringify(summary)
    return { type: 'knowledge', tag, content }
  } catch (error) {
    logger.error('Error processing knowledge context (db)', { knowledgeBaseId, error })
    return null
  }
}

async function processBlocksMetadata(
  blockIds: string[],
  tag: string
): Promise<AgentContext | null> {
  try {
    const { getBlocksMetadataServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
    )

    const uniqueBlockIds = Array.from(new Set(blockIds.filter(Boolean)))
    if (uniqueBlockIds.length === 0) {
      return null
    }

    const result = await getBlocksMetadataServerTool.execute({ blockIds: uniqueBlockIds })
    if (!result?.metadata || Object.keys(result.metadata).length === 0) {
      return null
    }

    const content = JSON.stringify(result)
    return { type: 'blocks', tag, content }
  } catch (error) {
    logger.error('Error processing block metadata', { blockIds, error })
    return null
  }
}

async function processTemplateFromDb(
  templateId: string,
  tag: string
): Promise<AgentContext | null> {
  try {
    const rows = await db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
        category: templates.category,
        author: templates.author,
        stars: templates.stars,
        state: templates.state,
      })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1)
    const t = rows?.[0]
    if (!t) return null
    const workflowState = (t as any).state || {}
    // Match get-user-workflow format: just the workflow state JSON
    const summary = {
      id: t.id,
      name: t.name,
      description: t.description || '',
      category: t.category,
      author: t.author,
      stars: t.stars || 0,
      workflow: workflowState,
    }
    const content = JSON.stringify(summary)
    return { type: 'templates', tag, content }
  } catch (error) {
    logger.error('Error processing template context (db)', { templateId, error })
    return null
  }
}

async function processWorkflowBlockFromDb(
  workflowId: string,
  blockId: string,
  label?: string
): Promise<AgentContext | null> {
  try {
    const normalized = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalized) return null
    const block = (normalized.blocks as any)[blockId]
    if (!block) return null
    const tag = label ? `@${label} in Workflow` : `@${block.name || blockId} in Workflow`

    // Build content: isolate the block and include its subBlocks fully
    const contentObj = {
      workflowId,
      block: block,
    }
    const content = JSON.stringify(contentObj)
    return { type: 'workflow_block', tag, content }
  } catch (error) {
    logger.error('Error processing workflow_block context', { workflowId, blockId, error })
    return null
  }
}

async function processExecutionLogFromDb(
  executionId: string,
  tag: string
): Promise<AgentContext | null> {
  try {
    const { workflowExecutionLogs, workflow } = await import('@tradinggoose/db/schema')
    const { db } = await import('@tradinggoose/db')
    const rows = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
        workflowName: workflow.name,
      })
      .from(workflowExecutionLogs)
      .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    const log = rows?.[0] as any
    if (!log) return null

    const summary = {
      id: log.id,
      workflowId: log.workflowId,
      executionId: log.executionId,
      level: log.level,
      trigger: log.trigger,
      startedAt: log.startedAt?.toISOString?.() || String(log.startedAt),
      endedAt: log.endedAt?.toISOString?.() || (log.endedAt ? String(log.endedAt) : null),
      totalDurationMs: log.totalDurationMs ?? null,
      workflowName: log.workflowName || '',
      // Include trace spans and any available details without being huge
      executionData: log.executionData
        ? {
            traceSpans: (log.executionData as any).traceSpans || undefined,
            errorDetails: (log.executionData as any).errorDetails || undefined,
          }
        : undefined,
      cost: log.cost || undefined,
    }

    const content = JSON.stringify(summary)
    return { type: 'logs', tag, content }
  } catch (error) {
    logger.error('Error processing execution log context (db)', { executionId, error })
    return null
  }
}
