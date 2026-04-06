import { db } from '@tradinggoose/db'
import {
  copilotReviewSessions,
  customTools,
  mcpServers,
  pineIndicators,
  skill,
} from '@tradinggoose/db/schema'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import { z } from 'zod'
import { getStableVibrantColor } from '@/lib/colors'
import {
  loadCustomTool,
  loadIndicator,
  loadMcpServer,
  loadSkill,
} from '@/lib/copilot/review-sessions/entity-loaders'
import {
  buildReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/identity'
import { loadReviewSessionForUser } from '@/lib/copilot/review-sessions/permissions'
import type { ReviewEntityKind, ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { IdempotencyService } from '@/lib/idempotency/service'
import { createLogger } from '@/lib/logs/console/logger'
import type { McpTransport } from '@/lib/mcp/types'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
import { normalizeStringArray, sanitizeRecord } from '@/lib/utils'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const logger = createLogger('SaveReviewEntity')

const SkillPayloadSchema = z.object({
  id: z.string().optional(),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  description: z.string().min(1).max(1024),
  content: z.string().min(1).max(50000),
})

const CustomToolPayloadSchema = z.object({
  id: z.string().optional(),
  schema: z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      parameters: z.object({
        type: z.string(),
        properties: z.record(z.any()),
        required: z.array(z.string()).optional(),
      }),
    }),
  }),
  code: z.string(),
})

const IndicatorPayloadSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  color: z.string().optional().nullable(),
  pineCode: z.string(),
  inputMeta: z.record(z.any()).optional().nullable(),
})

const McpPayloadSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  transport: z.enum(['http', 'sse', 'streamable-http']),
  url: z.string().optional().nullable(),
  headers: z.record(z.string()).optional(),
  command: z.string().optional().nullable(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  enabled: z.boolean().optional(),
})

const SaveSkillRequestSchema = z.object({
  entityKind: z.literal('skill'),
  workspaceId: z.string().min(1),
  reviewSessionId: z.string().uuid(),
  draftSessionId: z.string().optional(),
  skill: SkillPayloadSchema,
})

const SaveCustomToolRequestSchema = z.object({
  entityKind: z.literal('custom_tool'),
  workspaceId: z.string().min(1),
  reviewSessionId: z.string().uuid(),
  draftSessionId: z.string().optional(),
  customTool: CustomToolPayloadSchema,
})

const SaveIndicatorRequestSchema = z.object({
  entityKind: z.literal('indicator'),
  workspaceId: z.string().min(1),
  reviewSessionId: z.string().uuid(),
  draftSessionId: z.string().optional(),
  indicator: IndicatorPayloadSchema,
})

const SaveMcpRequestSchema = z.object({
  entityKind: z.literal('mcp_server'),
  workspaceId: z.string().min(1),
  reviewSessionId: z.string().uuid(),
  draftSessionId: z.string().optional(),
  mcpServer: McpPayloadSchema,
})

export const SaveReviewEntityRequestSchema = z.discriminatedUnion('entityKind', [
  SaveSkillRequestSchema,
  SaveCustomToolRequestSchema,
  SaveIndicatorRequestSchema,
  SaveMcpRequestSchema,
])

type SaveReviewEntityRequest = z.infer<typeof SaveReviewEntityRequestSchema>

interface LoadedReviewSession {
  id: string
  workspaceId: string | null
  entityKind: string
  entityId: string | null
  draftSessionId: string | null
  userId: string
  model: string
}

function resolveIndicatorColor(
  input: string | null | undefined,
  indicatorId: string,
  fallback?: string | null
): string {
  if (typeof input === 'string' && input.trim().length > 0) {
    return input.trim()
  }

  if (typeof fallback === 'string' && fallback.trim().length > 0) {
    return fallback.trim()
  }

  return getStableVibrantColor(indicatorId)
}

function assertReplaySafeSession(
  session: LoadedReviewSession,
  request: SaveReviewEntityRequest
): void {
  if (session.entityKind !== request.entityKind) {
    throw new SaveReviewEntityError(409, 'replay_unsafe')
  }

  if (session.workspaceId !== request.workspaceId) {
    throw new SaveReviewEntityError(409, 'replay_unsafe')
  }

  if (session.entityId && request.draftSessionId) {
    throw new SaveReviewEntityError(409, 'replay_unsafe')
  }

  if (!session.entityId && session.draftSessionId !== (request.draftSessionId ?? null)) {
    throw new SaveReviewEntityError(409, 'replay_unsafe')
  }
}

async function clearReseededFromCanonical(reviewSessionId: string): Promise<void> {
  const [{ getDocument, setPersistence }, { getState, storeState }] = await Promise.all([
    import('@/socket-server/yjs/upstream-utils'),
    import('@/socket-server/yjs/persistence'),
  ])

  setPersistence(reviewSessionId, { getState, storeState })
  const doc = getDocument(reviewSessionId)
  doc.transact(() => {
    doc.getMap('metadata').delete('reseededFromCanonical')
  }, YJS_ORIGINS.SAVE)
  await storeState(reviewSessionId, Y.encodeStateAsUpdate(doc))
}

async function buildReviewTargetFromSession(
  reviewSessionId: string
): Promise<ReviewTargetDescriptor> {
  const [row] = await db
    .select()
    .from(copilotReviewSessions)
    .where(eq(copilotReviewSessions.id, reviewSessionId))
    .limit(1)

  if (!row) {
    throw new SaveReviewEntityError(404, 'Review session not found')
  }

  return buildReviewTargetDescriptor(row)
}

async function loadSavedSkill(skillId: string, workspaceId: string) {
  const row = await loadSkill(skillId, workspaceId)
  if (!row) {
    throw new SaveReviewEntityError(404, 'Skill not found')
  }
  return row
}

async function loadSavedCustomTool(toolId: string, workspaceId: string) {
  const row = await loadCustomTool(toolId, workspaceId)
  if (!row) {
    throw new SaveReviewEntityError(404, 'Custom tool not found')
  }
  return row
}

async function loadSavedIndicator(indicatorId: string, workspaceId: string) {
  const row = await loadIndicator(indicatorId, workspaceId)
  if (!row) {
    throw new SaveReviewEntityError(404, 'Indicator not found')
  }
  return row
}

async function loadSavedMcp(serverId: string, workspaceId: string) {
  const row = await loadMcpServer(serverId, workspaceId)
  if (!row) {
    throw new SaveReviewEntityError(404, 'MCP server not found')
  }
  return row
}

// ---------------------------------------------------------------------------
// Shared save helpers
// ---------------------------------------------------------------------------

/**
 * Common update-path: validates payload id, delegates to entity-specific
 * updater, clears the reseeded marker, and returns a standardised response.
 */
async function executeUpdate(
  session: LoadedReviewSession,
  request: SaveReviewEntityRequest,
  payloadId: string | undefined,
  update: () => Promise<any>
) {
  if (payloadId && payloadId !== session.entityId) {
    throw new SaveReviewEntityError(409, 'replay_unsafe')
  }

  const saved = await update()
  await clearReseededFromCanonical(request.reviewSessionId)
  return {
    success: true as const,
    data: [saved],
    reviewTarget: await buildReviewTargetFromSession(request.reviewSessionId),
  }
}

/**
 * Common first-save (insert) path: idempotency guard → transaction →
 * session reload → entity insert → session promotion to saved-entity ownership.
 *
 * Callers provide:
 * - `loadExisting(entityId, workspaceId)` for the idempotent-replay branch
 * - `insert(tx)` for the actual conflict-check + row insert
 */
async function executeFirstSave(opts: {
  userId: string
  request: SaveReviewEntityRequest
  session: LoadedReviewSession
  loadExisting: (entityId: string, workspaceId: string) => Promise<any>
  insert: (tx: any) => Promise<{ entityId: string; saved: any }>
}) {
  const { userId, request, session, loadExisting, insert } = opts
  const idempotency = new IdempotencyService()

  return idempotency.executeWithIdempotency(
    'copilot-entity-first-save',
    request.reviewSessionId,
    async () => {
      return db.transaction(async (tx) => {
        const [currentSession] = await tx
          .select()
          .from(copilotReviewSessions)
          .where(
            and(
              eq(copilotReviewSessions.id, request.reviewSessionId),
              eq(copilotReviewSessions.userId, userId)
            )
          )
          .limit(1)

        if (!currentSession) {
          throw new SaveReviewEntityError(404, 'Review session not found')
        }

        if (currentSession.entityId) {
          const existing = await loadExisting(currentSession.entityId, request.workspaceId)
          return {
            success: true as const,
            data: [existing],
            reviewTarget: buildReviewTargetDescriptor(currentSession),
          }
        }

        const { entityId, saved } = await insert(tx)

        const now = new Date()
        const [updatedSession] = await tx
          .update(copilotReviewSessions)
          .set({
            entityId,
            draftSessionId: null,
            updatedAt: now,
          })
          .where(eq(copilotReviewSessions.id, request.reviewSessionId))
          .returning()

        return {
          success: true as const,
          data: [saved],
          reviewTarget: buildReviewTargetDescriptor(updatedSession),
        }
      })
    },
    {
      workspaceId: request.workspaceId,
      entityKind: request.entityKind,
      entityId: session.entityId ?? null,
      draftSessionId: session.draftSessionId ?? request.draftSessionId ?? null,
    }
  )
}

// ---------------------------------------------------------------------------
// Entity-specific save functions
// ---------------------------------------------------------------------------

async function saveSkill(
  userId: string,
  request: Extract<SaveReviewEntityRequest, { entityKind: 'skill' }>,
  session: LoadedReviewSession
) {
  const nextPayload = request.skill

  if (session.entityId) {
    return executeUpdate(session, request, nextPayload.id, async () => {
      const current = await loadSavedSkill(session.entityId!, request.workspaceId)
      if (nextPayload.name !== current.name) {
        const conflict = await db
          .select({ id: skill.id })
          .from(skill)
          .where(
            and(
              eq(skill.workspaceId, request.workspaceId),
              eq(skill.name, nextPayload.name),
              ne(skill.id, session.entityId!)
            )
          )
          .limit(1)

        if (conflict.length > 0) {
          throw new SaveReviewEntityError(
            409,
            `A skill with the name "${nextPayload.name}" already exists in this workspace`
          )
        }
      }

      const [saved] = await db
        .update(skill)
        .set({
          name: nextPayload.name,
          description: nextPayload.description,
          content: nextPayload.content,
          updatedAt: new Date(),
        })
        .where(and(eq(skill.id, session.entityId!), eq(skill.workspaceId, request.workspaceId)))
        .returning()

      return saved
    })
  }

  return executeFirstSave({
    userId,
    request,
    session,
    loadExisting: loadSavedSkill,
    insert: async (tx) => {
      const duplicate = await tx
        .select({ id: skill.id })
        .from(skill)
        .where(and(eq(skill.workspaceId, request.workspaceId), eq(skill.name, nextPayload.name)))
        .limit(1)

      if (duplicate.length > 0) {
        throw new SaveReviewEntityError(
          409,
          `A skill with the name "${nextPayload.name}" already exists in this workspace`
        )
      }

      const skillId = nanoid()
      const now = new Date()
      const [saved] = await tx
        .insert(skill)
        .values({
          id: skillId,
          workspaceId: request.workspaceId,
          userId,
          name: nextPayload.name,
          description: nextPayload.description,
          content: nextPayload.content,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      return { entityId: skillId, saved }
    },
  })
}

async function saveCustomTool(
  userId: string,
  request: Extract<SaveReviewEntityRequest, { entityKind: 'custom_tool' }>,
  session: LoadedReviewSession
) {
  const title = request.customTool.schema.function.name
  const schema = request.customTool.schema
  const code = request.customTool.code

  if (session.entityId) {
    return executeUpdate(session, request, request.customTool.id, async () => {
      const [saved] = await db
        .update(customTools)
        .set({ title, schema, code, updatedAt: new Date() })
        .where(
          and(
            eq(customTools.id, session.entityId!),
            eq(customTools.workspaceId, request.workspaceId)
          )
        )
        .returning()

      if (!saved) {
        throw new SaveReviewEntityError(404, 'Custom tool not found')
      }

      return saved
    })
  }

  return executeFirstSave({
    userId,
    request,
    session,
    loadExisting: loadSavedCustomTool,
    insert: async (tx) => {
      const duplicate = await tx
        .select({ id: customTools.id })
        .from(customTools)
        .where(and(eq(customTools.workspaceId, request.workspaceId), eq(customTools.title, title)))
        .limit(1)

      if (duplicate.length > 0) {
        throw new SaveReviewEntityError(
          409,
          `A tool with the title "${title}" already exists in this workspace`
        )
      }

      const toolId = nanoid()
      const now = new Date()
      const [saved] = await tx
        .insert(customTools)
        .values({
          id: toolId,
          workspaceId: request.workspaceId,
          userId,
          title,
          schema,
          code,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      return { entityId: toolId, saved }
    },
  })
}

async function saveIndicator(
  userId: string,
  request: Extract<SaveReviewEntityRequest, { entityKind: 'indicator' }>,
  session: LoadedReviewSession
) {
  const nextPayload = request.indicator

  if (session.entityId) {
    return executeUpdate(session, request, nextPayload.id, async () => {
      const current = await loadSavedIndicator(session.entityId!, request.workspaceId)
      const [saved] = await db
        .update(pineIndicators)
        .set({
          name: nextPayload.name,
          color: resolveIndicatorColor(nextPayload.color, session.entityId!, current.color),
          pineCode: nextPayload.pineCode,
          inputMeta: nextPayload.inputMeta ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pineIndicators.id, session.entityId!),
            eq(pineIndicators.workspaceId, request.workspaceId)
          )
        )
        .returning()

      return saved
    })
  }

  return executeFirstSave({
    userId,
    request,
    session,
    loadExisting: loadSavedIndicator,
    insert: async (tx) => {
      const indicatorId = crypto.randomUUID()
      const now = new Date()
      const [saved] = await tx
        .insert(pineIndicators)
        .values({
          id: indicatorId,
          workspaceId: request.workspaceId,
          userId,
          name: nextPayload.name,
          color: resolveIndicatorColor(nextPayload.color, indicatorId),
          pineCode: nextPayload.pineCode,
          inputMeta: nextPayload.inputMeta ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      return { entityId: indicatorId, saved }
    },
  })
}

async function saveMcpServer(
  userId: string,
  request: Extract<SaveReviewEntityRequest, { entityKind: 'mcp_server' }>,
  session: LoadedReviewSession
) {
  const payload = request.mcpServer
  const normalizedUrl =
    payload.url && payload.transport
      ? normalizeMcpUrl(payload.transport, payload.url)
      : (payload.url ?? null)
  const headers = sanitizeRecord(payload.headers ?? {})
  const env = sanitizeRecord(payload.env ?? {})
  const args = normalizeStringArray(payload.args ?? [])

  const mcpValues = {
    name: payload.name,
    description: payload.description ?? null,
    transport: payload.transport,
    url: normalizedUrl,
    headers,
    command: payload.command ?? null,
    args,
    env,
    timeout: payload.timeout ?? 30000,
    retries: payload.retries ?? 3,
    enabled: payload.enabled ?? true,
  }

  if (session.entityId) {
    return executeUpdate(session, request, payload.id, async () => {
      const [saved] = await db
        .update(mcpServers)
        .set({ ...mcpValues, updatedAt: new Date() })
        .where(
          and(
            eq(mcpServers.id, session.entityId!),
            eq(mcpServers.workspaceId, request.workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .returning()

      if (!saved) {
        throw new SaveReviewEntityError(404, 'MCP server not found')
      }

      return saved
    })
  }

  return executeFirstSave({
    userId,
    request,
    session,
    loadExisting: loadSavedMcp,
    insert: async (tx) => {
      const serverId = payload.id || crypto.randomUUID()
      const now = new Date()
      const [saved] = await tx
        .insert(mcpServers)
        .values({
          id: serverId,
          workspaceId: request.workspaceId,
          createdBy: userId,
          ...mcpValues,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      return { entityId: serverId, saved }
    },
  })
}

function normalizeMcpUrl(transport: McpTransport, url: string | null | undefined): string | null {
  if (!url || transport === 'http' || transport === 'sse' || transport === 'streamable-http') {
    if (!url?.trim()) {
      return null
    }
    const validation = validateMcpServerUrl(url)
    if (!validation.isValid) {
      throw new SaveReviewEntityError(400, validation.error || 'Invalid server URL')
    }
    return validation.normalizedUrl ?? url.trim()
  }

  return url ?? null
}

export async function saveReviewEntity(userId: string, request: SaveReviewEntityRequest) {
  const reviewSession = await loadReviewSessionForUser(request.reviewSessionId, userId, {
    requireWrite: true,
  })
  if (!reviewSession) {
    throw new SaveReviewEntityError(404, 'Review session not found')
  }

  assertReplaySafeSession(reviewSession, request)

  switch (request.entityKind) {
    case 'skill':
      return saveSkill(userId, request, reviewSession)
    case 'custom_tool':
      return saveCustomTool(userId, request, reviewSession)
    case 'indicator':
      return saveIndicator(userId, request, reviewSession)
    case 'mcp_server':
      return saveMcpServer(userId, request, reviewSession)
  }
}

export class SaveReviewEntityError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'SaveReviewEntityError'
  }
}
