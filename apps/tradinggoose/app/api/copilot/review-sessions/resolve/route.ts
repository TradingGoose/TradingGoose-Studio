import { db } from '@tradinggoose/db'
import { copilotReviewSessions } from '@tradinggoose/db/schema'
import { eq, and } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  buildSessionScopeKey,
  buildReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/identity'
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

function getDefaultRuntime(): ResolvedReviewTarget['runtime'] {
  return {
    docState: 'active',
    replaySafe: true,
    reseededFromCanonical: false,
  }
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
  reviewModel: z.string().min(1),
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

    const { workspaceId, entityKind, reviewModel, reviewSessionId, entityId, draftSessionId } =
      parseResult.data

    // This route is entity-only; workflow mode never calls it
    if (entityKind === 'workflow') {
      return NextResponse.json(
        { error: 'Workflow review sessions cannot be resolved through this endpoint' },
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
      if (row.entityKind !== entityKind || row.workspaceId !== workspaceId) {
        logger.warn('Review session target mismatch', {
          reviewSessionId,
          expected: { entityKind, workspaceId },
          actual: { entityKind: row.entityKind, workspaceId: row.workspaceId },
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

    // Precedence 2: Build scope key, look up by sessionScopeKey
    // For saved entities, the scope key is workspace-scoped (shared across users)
    // For drafts, the scope key includes userId (user-owned)
    const sessionScopeKey = buildSessionScopeKey({
      userId,
      workspaceId,
      entityKind: entityKind as ReviewEntityKind,
      entityId: entityId ?? null,
      draftSessionId: draftSessionId ?? null,
    })

    if (sessionScopeKey) {
      const isDraft = !entityId && !!draftSessionId
      const existingRows = await db
        .select()
        .from(copilotReviewSessions)
        .where(
          isDraft
            ? and(
                eq(copilotReviewSessions.userId, userId),
                eq(copilotReviewSessions.sessionScopeKey, sessionScopeKey)
              )
            : eq(copilotReviewSessions.sessionScopeKey, sessionScopeKey)
        )
        .limit(1)

      if (existingRows.length) {
        const row = existingRows[0]

        // Update model if it changed
        if (row.model !== reviewModel) {
          await db
            .update(copilotReviewSessions)
            .set({ model: reviewModel, updatedAt: new Date() })
            .where(eq(copilotReviewSessions.id, row.id))
          row.model = reviewModel
        }

        const descriptor = {
          ...buildReviewTargetDescriptor(row),
          workspaceId: accessResult.workspaceId ?? row.workspaceId,
        }

        return NextResponse.json(await resolveRuntimeForDescriptor(descriptor))
      }
    }

    // Cache miss: create a new row guarded by unique constraint on sessionScopeKey
    try {
      const insertedRows = await db
        .insert(copilotReviewSessions)
        .values({
          workspaceId,
          entityKind,
          entityId: entityId ?? null,
          draftSessionId: draftSessionId ?? null,
          sessionScopeKey,
          userId,
          model: reviewModel,
        })
        .returning()

      const row = insertedRows[0]
      logger.debug('Created new review session', {
        reviewSessionId: row.id,
        entityKind,
        workspaceId,
        sessionScopeKey,
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

      if (isUniqueViolation && sessionScopeKey) {
        logger.debug('Concurrent insert detected, fetching existing row', { sessionScopeKey })

        const isDraft = !entityId && !!draftSessionId
        const existingRows = await db
          .select()
          .from(copilotReviewSessions)
          .where(
            isDraft
              ? and(
                  eq(copilotReviewSessions.userId, userId),
                  eq(copilotReviewSessions.sessionScopeKey, sessionScopeKey)
                )
              : eq(copilotReviewSessions.sessionScopeKey, sessionScopeKey)
          )
          .limit(1)

        if (existingRows.length) {
          const row = existingRows[0]
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
