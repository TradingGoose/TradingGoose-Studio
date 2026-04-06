import { db } from '@tradinggoose/db'
import { copilotReviewSessions } from '@tradinggoose/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  buildReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/identity'
import { COPILOT_RUNTIME_CONFIG_PLACEHOLDER } from '@/lib/copilot/session-scope'
import {
  loadReviewSessionForUser,
  verifyReviewTargetAccess,
} from '@/lib/copilot/review-sessions/permissions'
import type { ResolvedReviewTarget, ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { createLogger } from '@/lib/logs/console/logger'
import {
  bootstrapReviewTarget,
  ReviewTargetBootstrapError,
} from '@/lib/yjs/server/bootstrap-review-target'

const logger = createLogger('ReviewSessionResolveAPI')

function buildEntityReviewSessionConditions(params: {
  userId: string
  workspaceId: string
  entityKind: ReviewEntityKind
  entityId?: string | null
  draftSessionId?: string | null
}) {
  // Dedicated entity review sessions are keyed by the reviewed entity/draft target,
  // not by widget panel channel. They keep accept/reject/edit state attached to the
  // entity even if the user changes what another generic copilot panel is viewing.
  const baseConditions = [
    eq(copilotReviewSessions.workspaceId, params.workspaceId),
    eq(copilotReviewSessions.entityKind, params.entityKind),
    isNull(copilotReviewSessions.channelId),
  ]

  if (params.entityId) {
    return [
      ...baseConditions,
      eq(copilotReviewSessions.entityId, params.entityId),
      isNull(copilotReviewSessions.draftSessionId),
    ]
  }

  if (params.draftSessionId) {
    return [
      ...baseConditions,
      eq(copilotReviewSessions.userId, params.userId),
      isNull(copilotReviewSessions.entityId),
      eq(copilotReviewSessions.draftSessionId, params.draftSessionId),
    ]
  }

  throw new Error('Entity review target requires either entityId or draftSessionId')
}

async function loadExistingEntityReviewSession(params: {
  userId: string
  workspaceId: string
  entityKind: ReviewEntityKind
  entityId?: string | null
  draftSessionId?: string | null
}) {
  const rows = await db
    .select()
    .from(copilotReviewSessions)
    .where(and(...buildEntityReviewSessionConditions(params)))
    .limit(1)

  return rows[0] ?? null
}

function getDefaultRuntime(): ResolvedReviewTarget['runtime'] {
  return {
    docState: 'active',
    replaySafe: true,
    reseededFromCanonical: false,
  }
}

function doesLoadedSessionMatchRequestedTarget(params: {
  row: {
    workspaceId: string | null
    entityKind: string
    entityId: string | null
    draftSessionId: string | null
  }
  workspaceId: string
  entityKind: ReviewEntityKind
  entityId?: string | null
  draftSessionId?: string | null
}): boolean {
  const { row, workspaceId, entityKind, entityId, draftSessionId } = params

  if (row.entityKind !== entityKind || row.workspaceId !== workspaceId) {
    return false
  }

  if (entityId !== undefined && entityId !== null) {
    return row.entityId === entityId && row.draftSessionId === null
  }

  if (draftSessionId !== undefined && draftSessionId !== null) {
    return row.entityId === null && row.draftSessionId === draftSessionId
  }

  return true
}

async function resolveRuntimeForDescriptor(
  descriptor: ReturnType<typeof buildReviewTargetDescriptor>
): Promise<ResolvedReviewTarget> {
  if (!descriptor.entityId) {
    return {
      descriptor,
      runtime: getDefaultRuntime(),
    }
  }

  return bootstrapReviewTarget(descriptor)
}

const ResolveRequestSchema = z.object({
  workspaceId: z.string().min(1),
  entityKind: z.enum(['workflow', 'mcp_server', 'skill', 'custom_tool', 'indicator']),
  reviewSessionId: z.string().optional(),
  entityId: z.string().optional(),
  draftSessionId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const body = await req.json()
    const parseResult = ResolveRequestSchema.safeParse(body)
    if (!parseResult.success) {
      logger.warn('Invalid resolve request', { errors: parseResult.error.flatten() })
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { workspaceId, entityKind, reviewSessionId, entityId, draftSessionId } =
      parseResult.data

    // This route is entity-only; workflow mode never calls it
    if (entityKind === 'workflow') {
      return NextResponse.json(
        { error: 'Workflow review sessions cannot be resolved through this endpoint' },
        { status: 400 }
      )
    }

    if (!reviewSessionId && !entityId && !draftSessionId) {
      return NextResponse.json(
        { error: 'entityId or draftSessionId is required when reviewSessionId is not provided' },
        { status: 400 }
      )
    }

    // Verify access
    const accessResult = await verifyReviewTargetAccess(userId, {
      entityKind,
      entityId: entityId ?? null,
      workspaceId,
    })

    if (!accessResult.hasAccess) {
      logger.warn('Access denied for review session resolve', {
        userId,
        workspaceId,
        entityKind,
      })
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Precedence 1: If reviewSessionId provided, load the accessible session row.
    if (reviewSessionId) {
      const row = await loadReviewSessionForUser(reviewSessionId, userId)

      if (!row) {
        logger.warn('Review session not found', { reviewSessionId, userId })
        return NextResponse.json({ error: 'Review session not found' }, { status: 404 })
      }

      // Verify the loaded session matches the requested target
      if (
        !doesLoadedSessionMatchRequestedTarget({
          row,
          workspaceId,
          entityKind,
          entityId: entityId ?? null,
          draftSessionId: draftSessionId ?? null,
        })
      ) {
        logger.warn('Review session target mismatch', {
          reviewSessionId,
          expected: {
            entityKind,
            workspaceId,
            entityId: entityId ?? null,
            draftSessionId: draftSessionId ?? null,
          },
          actual: {
            entityKind: row.entityKind,
            workspaceId: row.workspaceId,
            entityId: row.entityId,
            draftSessionId: row.draftSessionId,
          },
        })
        return NextResponse.json(
          { error: 'Review session does not match requested target' },
          { status: 409 }
        )
      }

      const descriptor = {
        ...buildReviewTargetDescriptor(row),
        workspaceId: accessResult.workspaceId ?? row.workspaceId,
      }

      return NextResponse.json(await resolveRuntimeForDescriptor(descriptor))
    }

    const existingSession = await loadExistingEntityReviewSession({
      userId,
      workspaceId,
      entityKind: entityKind as ReviewEntityKind,
      entityId: entityId ?? null,
      draftSessionId: draftSessionId ?? null,
    })

    if (existingSession) {
      const descriptor = {
        ...buildReviewTargetDescriptor(existingSession),
        workspaceId: accessResult.workspaceId ?? existingSession.workspaceId,
      }

      return NextResponse.json(await resolveRuntimeForDescriptor(descriptor))
    }

    // Cache miss: create a new row guarded by explicit saved-entity/draft uniqueness.
    try {
      const insertedRows = await db
        .insert(copilotReviewSessions)
        .values({
          workspaceId,
          entityKind,
          entityId: entityId ?? null,
          draftSessionId: draftSessionId ?? null,
          userId,
          model: COPILOT_RUNTIME_CONFIG_PLACEHOLDER,
        })
        .returning()

      const row = insertedRows[0]
      logger.debug('Created new review session', {
        reviewSessionId: row.id,
        entityKind,
        workspaceId,
        entityId: row.entityId,
        draftSessionId: row.draftSessionId,
      })

      const descriptor = {
        ...buildReviewTargetDescriptor(row),
        workspaceId: accessResult.workspaceId ?? row.workspaceId,
      }

      return NextResponse.json(await resolveRuntimeForDescriptor(descriptor), { status: 201 })
    } catch (insertError: unknown) {
      // Unique constraint violation: another request created the row concurrently
      const isUniqueViolation =
        insertError instanceof Error &&
        ('code' in insertError || 'constraint' in insertError) &&
        String((insertError as Record<string, unknown>).code) === '23505'

      if (isUniqueViolation) {
        logger.debug('Concurrent insert detected, fetching existing row', {
          entityKind,
          workspaceId,
          entityId: entityId ?? null,
          draftSessionId: draftSessionId ?? null,
        })

        const row = await loadExistingEntityReviewSession({
          userId,
          workspaceId,
          entityKind: entityKind as ReviewEntityKind,
          entityId: entityId ?? null,
          draftSessionId: draftSessionId ?? null,
        })

        if (row) {
          const descriptor = {
            ...buildReviewTargetDescriptor(row),
            workspaceId: accessResult.workspaceId ?? row.workspaceId,
          }

          return NextResponse.json(await resolveRuntimeForDescriptor(descriptor))
        }
      }

      throw insertError
    }
  } catch (error) {
    if (error instanceof ReviewTargetBootstrapError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error('Error resolving review session', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
