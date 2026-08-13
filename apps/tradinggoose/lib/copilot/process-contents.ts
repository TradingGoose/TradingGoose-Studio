import { db } from '@tradinggoose/db'
import {
  copilotReviewItems,
  copilotReviewSessions,
  permissions,
  workflow,
  workflowExecutionLogs,
  workspace,
} from '@tradinggoose/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { verifyWorkflowAccess } from '@/lib/copilot/review-sessions/permissions'
import { REVIEW_ITEM_KINDS } from '@/lib/copilot/review-sessions/thread-history'
import { ENTITY_KIND_KNOWLEDGE_BASE } from '@/lib/copilot/review-sessions/types'
import { createLogger } from '@/lib/logs/console/logger'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'
import { escapeRegExp } from '@/lib/utils'
import { readBootstrappedReviewTargetSnapshot } from '@/lib/yjs/server/bootstrap-review-target'
import { readWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import type { ChatContext } from '@/stores/copilot/types'
import { readCopilotWorkspaceEntityContext } from '@/widgets/widgets/copilot/workspace-entities'

type AgentContextType = ChatContext['kind']

interface AgentContext {
  type: AgentContextType
  tag?: string
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
      const entityContext = readCopilotWorkspaceEntityContext(ctx)
      const contextWorkspaceId =
        entityContext?.workspaceId ??
        ('workspaceId' in ctx && typeof ctx.workspaceId === 'string' ? ctx.workspaceId : null)
      const requiresActiveWorkspace =
        entityContext?.entityKind === ENTITY_KIND_KNOWLEDGE_BASE ||
        ctx.kind === 'logs' ||
        ctx.kind === 'current_logs' ||
        ctx.kind === 'current_monitor'

      if (requiresActiveWorkspace && (!workspaceId || contextWorkspaceId !== workspaceId)) {
        return null
      }

      if (entityContext?.entityId) {
        if (entityContext.entityKind === ENTITY_KIND_KNOWLEDGE_BASE) {
          const { readKnowledgeBaseServerTool } = await import(
            '@/lib/copilot/tools/server/knowledge/knowledge-base'
          )
          const knowledgeBase = await readKnowledgeBaseServerTool.execute(
            { entityId: entityContext.entityId },
            { userId, workspaceId }
          )
          return {
            type: entityContext.current ? 'current_knowledge_base' : 'knowledge_base',
            tag: `@${entityContext.entityId}`,
            content: JSON.stringify(knowledgeBase, null, 2),
          }
        }
        return {
          type: ctx.kind,
          tag: `@${entityContext.entityId}`,
          content: JSON.stringify({ entityId: entityContext.entityId }, null, 2),
        }
      }

      if (ctx.kind === 'past_chat' && ctx.reviewSessionId) {
        return await processPastChatContext(
          ctx.reviewSessionId,
          userId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if (ctx.kind === 'blocks') {
        return await processBlocksMetadata(ctx.blockTypes ?? [], ctx.label ? `@${ctx.label}` : '@')
      }
      if ((ctx.kind === 'logs' || ctx.kind === 'current_logs') && ctx.logId) {
        return await processLogContext(
          ctx.logId,
          ctx.workspaceId,
          userId,
          ctx.kind,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if (ctx.kind === 'current_monitor' && ctx.monitorId) {
        const { readMonitorServerTool } = await import(
          '@/lib/copilot/tools/server/monitor/read-monitor'
        )
        const monitor = await readMonitorServerTool.execute(
          { monitorId: ctx.monitorId },
          { userId, workspaceId: ctx.workspaceId }
        )
        return {
          type: 'current_monitor',
          tag: ctx.label ? `@${ctx.label}` : '@',
          content: JSON.stringify(monitor, null, 2),
        }
      }
      if (ctx.kind === 'workflow_block' && ctx.workflowId && ctx.blockId) {
        return await processWorkflowBlockContext(ctx.workflowId, ctx.blockId, userId, ctx.label)
      }
      if (ctx.kind === 'docs') {
        const { searchDocumentationServerTool } = await import(
          '@/lib/copilot/tools/server/docs/search-documentation'
        )
        const rawQuery = (userMessage || '').trim() || ctx.label || 'TradingGoose Documentation'
        const query = sanitizeMessageForDocs(rawQuery, contexts)
        const res = await searchDocumentationServerTool.execute({ query, topK: 10 })
        const content = JSON.stringify(res?.results || [])
        return { type: 'docs', tag: ctx.label ? `@${ctx.label}` : '@', content }
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

async function readBootstrappedCopilotYjsDoc<T>(
  descriptor: Parameters<typeof readBootstrappedReviewTargetSnapshot>[0],
  read: (doc: Y.Doc) => T
): Promise<T | null> {
  const snapshot = await readBootstrappedReviewTargetSnapshot(descriptor)
  if (!snapshot.snapshotBase64) {
    return null
  }

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
    return read(doc)
  } finally {
    doc.destroy()
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

async function processPastChatContext(
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

    logger.info('Processed past_chat context', {
      reviewSessionId,
      length: content.length,
      lines: content ? content.split('\n').length : 0,
    })
    return { type: 'past_chat', tag, content }
  } catch (error) {
    logger.error('Error processing past chat context', { reviewSessionId, error })
    return null
  }
}

async function processBlocksMetadata(
  blockTypes: string[],
  tag: string
): Promise<AgentContext | null> {
  const uniqueBlockTypes = Array.from(new Set(blockTypes.filter(Boolean)))
  if (uniqueBlockTypes.length === 0) {
    return null
  }

  try {
    const { getBlocksMetadataServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-blocks-metadata'
    )

    const result = await getBlocksMetadataServerTool.execute({ blockTypes: uniqueBlockTypes })
    if (!result?.metadata || Object.keys(result.metadata).length === 0) {
      return null
    }

    const content = JSON.stringify(result)
    return { type: 'blocks', tag, content }
  } catch (error) {
    logger.error('Error processing block metadata', { blockTypes, error })
    return null
  }
}

async function processWorkflowBlockContext(
  workflowId: string,
  blockId: string,
  userId: string,
  label?: string
): Promise<AgentContext | null> {
  try {
    const workflowState = await readCopilotWorkflowStateFromYjs(workflowId, userId)
    if (!workflowState) return null
    const block = (workflowState.blocks as any)[blockId]
    if (!block) return null
    const tag = label ? `@${label} in Workflow` : `@${block.name || blockId} in Workflow`

    // Build content: isolate the block and include its subBlocks fully
    const contentObj = {
      workflowId,
      block,
    }
    const content = JSON.stringify(contentObj)
    return { type: 'workflow_block', tag, content }
  } catch (error) {
    logger.error('Error processing workflow_block context', { workflowId, blockId, error })
    return null
  }
}

async function readCopilotWorkflowStateFromYjs(
  workflowId: string,
  userId: string
): Promise<WorkflowSnapshot | null> {
  const access = await verifyWorkflowAccess(userId, workflowId, 'read')
  if (!access.hasAccess) {
    logger.warn('Skipping unauthorized copilot workflow context', {
      workflowId,
      userId,
    })
    return null
  }

  const workflowState = await readBootstrappedCopilotYjsDoc(
    {
      workspaceId: access.workspaceId ?? null,
      ownerUserId: null,
      entityKind: 'workflow',
      entityId: workflowId,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: workflowId,
    },
    readWorkflowSnapshot
  )
  if (!workflowState) {
    logger.warn('No workflow Yjs snapshot found for copilot context', { workflowId })
    return null
  }

  return workflowState
}

async function processLogContext(
  logId: string,
  contextWorkspaceId: string,
  userId: string,
  contextType: 'logs' | 'current_logs',
  tag: string
): Promise<AgentContext | null> {
  try {
    const workspaceAccess = buildWorkspaceAccessScope(userId, workflowExecutionLogs.workspaceId)
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
        workflowSummary: workflowExecutionLogs.workflowSummary,
        entityName: workflow.name,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .innerJoin(workspace, workspaceAccess.workspaceJoin)
      .leftJoin(permissions, workspaceAccess.permissionJoin)
      .where(
        and(
          eq(workflowExecutionLogs.id, logId),
          eq(workflowExecutionLogs.workspaceId, contextWorkspaceId),
          workspaceAccess.accessFilter
        )
      )
      .limit(1)

    const log = rows?.[0] as any
    if (!log) return null
    const workflowSummary =
      log.workflowSummary && typeof log.workflowSummary === 'object' ? log.workflowSummary : {}

    const summary = {
      id: log.id,
      workflowId: log.workflowId ?? workflowSummary.id ?? null,
      executionId: log.executionId,
      level: log.level,
      trigger: log.trigger,
      startedAt: log.startedAt?.toISOString?.() || String(log.startedAt),
      endedAt: log.endedAt?.toISOString?.() || (log.endedAt ? String(log.endedAt) : null),
      totalDurationMs: log.totalDurationMs ?? null,
      entityName: log.entityName || workflowSummary.name || '',
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
    return { type: contextType, tag, content }
  } catch (error) {
    logger.error('Error processing log context', { logId, error })
    return null
  }
}
