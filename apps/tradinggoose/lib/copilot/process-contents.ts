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
import { buildCopilotContextIdentityKey, isHiddenCopilotContext } from '@/lib/copilot/chat-contexts'
import {
  COPILOT_CONTEXT_PROJECTION_LIMITS,
  MAX_COPILOT_CONTEXT_BYTES_PER_ITEM,
  MAX_COPILOT_CONTEXT_BYTES_PER_TURN,
  MAX_COPILOT_CONTEXTS_PER_TURN,
} from '@/lib/copilot/context-limits'
import { projectExecutionLogContext } from '@/lib/copilot/execution-log-context'
import { verifyWorkflowAccess } from '@/lib/copilot/review-sessions/permissions'
import { REVIEW_ITEM_KINDS } from '@/lib/copilot/review-sessions/thread-history'
import { ENTITY_KIND_KNOWLEDGE_BASE } from '@/lib/copilot/review-sessions/types'
import { readCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import { createLogger } from '@/lib/logs/console/logger'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'
import { stringifyBoundedRedactedJson } from '@/lib/security/redaction'
import { escapeRegExp } from '@/lib/utils'
import { readBootstrappedReviewTargetSnapshot } from '@/lib/yjs/server/bootstrap-review-target'
import { readWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import type { ChatContext } from '@/stores/copilot/types'

type AgentContextType = ChatContext['kind']

interface AgentContext {
  type: AgentContextType
  tag?: string
  content: string
}

type ProcessContextsServerOptions = {
  signal?: AbortSignal
}

const logger = createLogger('ProcessContents')

function throwIfContextProcessingAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error && signal.reason.name === 'AbortError') throw signal.reason
  const abortError = new Error('Aborted')
  abortError.name = 'AbortError'
  throw abortError
}

function stringifyBoundedContext(value: unknown, fallback: Record<string, unknown>): string {
  const content = stringifyBoundedRedactedJson(value, COPILOT_CONTEXT_PROJECTION_LIMITS)
  return Buffer.byteLength(content, 'utf8') <= MAX_COPILOT_CONTEXT_BYTES_PER_ITEM
    ? content
    : JSON.stringify({ ...fallback, contextTruncated: true })
}

// Server-side variant (recommended for use in API routes)
export async function processContextsServer(
  contexts: ChatContext[] | undefined,
  userId: string,
  userMessage?: string,
  workspaceId?: string,
  options: ProcessContextsServerOptions = {}
): Promise<AgentContext[]> {
  throwIfContextProcessingAborted(options.signal)
  if (!Array.isArray(contexts) || contexts.length === 0) return []

  if (contexts.length > MAX_COPILOT_CONTEXTS_PER_TURN) {
    logger.warn('Ignoring Copilot contexts above the per-turn limit', {
      requested: contexts.length,
      limit: MAX_COPILOT_CONTEXTS_PER_TURN,
    })
  }
  const uniqueContextsByKey = new Map<string, ChatContext>()
  for (const context of contexts.slice(0, MAX_COPILOT_CONTEXTS_PER_TURN)) {
    try {
      const key = buildCopilotContextIdentityKey(context)
      const existing = uniqueContextsByKey.get(key)
      if (!existing || (isHiddenCopilotContext(existing) && !isHiddenCopilotContext(context))) {
        uniqueContextsByKey.set(key, context)
      }
    } catch (error) {
      logger.warn('Skipping Copilot context with invalid identity', { context, error })
    }
  }
  const uniqueContexts = [...uniqueContextsByKey.values()]

  const tasks = uniqueContexts.map(async (ctx) => {
    try {
      throwIfContextProcessingAborted(options.signal)
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

      const currentEntityId =
        entityContext?.entityId ??
        (ctx.kind === 'current_logs'
          ? ctx.logId
          : ctx.kind === 'current_monitor'
            ? ctx.monitorId
            : null)
      if (isHiddenCopilotContext(ctx) && currentEntityId) {
        return {
          type: ctx.kind,
          tag: `@${currentEntityId}`,
          content: JSON.stringify({ entityId: currentEntityId }, null, 2),
        }
      }

      if (entityContext?.entityId) {
        if (entityContext.entityKind === ENTITY_KIND_KNOWLEDGE_BASE) {
          const { readKnowledgeBaseServerTool } = await import(
            '@/lib/copilot/tools/server/knowledge/knowledge-base'
          )
          const knowledgeBase = await readKnowledgeBaseServerTool.execute(
            { entityId: entityContext.entityId },
            { userId, workspaceId, ...(options.signal ? { signal: options.signal } : {}) }
          )
          throwIfContextProcessingAborted(options.signal)
          return {
            type: entityContext.current ? 'current_knowledge_base' : 'knowledge_base',
            tag: `@${entityContext.entityId}`,
            content: stringifyBoundedContext(knowledgeBase, {
              entityId: entityContext.entityId,
            }),
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
      if (ctx.kind === 'logs' && ctx.logId) {
        return await processLogContext(
          ctx.logId,
          ctx.workspaceId,
          userId,
          ctx.label ? `@${ctx.label}` : '@'
        )
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
      throwIfContextProcessingAborted(options.signal)
      logger.error('Failed processing context (server)', { ctx, error })
      return null
    }
  })
  const results = await Promise.all(tasks)
  throwIfContextProcessingAborted(options.signal)
  const filtered = results.filter(
    (r): r is AgentContext => !!r && typeof r.content === 'string' && r.content.trim().length > 0
  )
  const bounded: AgentContext[] = []
  let totalBytes = 2
  let omittedForSize = 0
  for (const context of filtered) {
    const contextBytes = Buffer.byteLength(JSON.stringify(context), 'utf8')
    const separatorBytes = bounded.length > 0 ? 1 : 0
    if (totalBytes + separatorBytes + contextBytes > MAX_COPILOT_CONTEXT_BYTES_PER_TURN) {
      omittedForSize += 1
      continue
    }
    totalBytes += separatorBytes + contextBytes
    bounded.push(context)
  }
  if (omittedForSize > 0) {
    logger.warn('Omitted Copilot contexts above the aggregate byte limit', {
      omitted: omittedForSize,
      limitBytes: MAX_COPILOT_CONTEXT_BYTES_PER_TURN,
    })
  }
  logger.info('Processed contexts (server)', {
    totalRequested: contexts.length,
    totalProcessed: bounded.length,
    kinds: Array.from(bounded.reduce((s, r) => s.add(r.type), new Set<string>())),
  })
  return bounded
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
    const { content } = projectExecutionLogContext(log, 'explicit')
    return { type: 'logs', tag, content }
  } catch (error) {
    logger.error('Error processing log context', { logId, error })
    return null
  }
}
