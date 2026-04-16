import { db } from '@tradinggoose/db'
import { copilotReviewSessions } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { COPILOT_SESSION_KIND } from '@/lib/copilot/session-scope'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UpdateChatTitleAPI')

const UpdateTitleSchema = z.object({
  reviewSessionId: z.string(),
  title: z.string(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = UpdateTitleSchema.parse(body)

    // Single UPDATE with ownership check in the WHERE clause avoids a TOCTOU
    // race between a separate SELECT and UPDATE.
    const updated = await db
      .update(copilotReviewSessions)
      .set({
        title: parsed.title,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(copilotReviewSessions.id, parsed.reviewSessionId),
          eq(copilotReviewSessions.userId, session.user.id),
          eq(copilotReviewSessions.entityKind, COPILOT_SESSION_KIND)
        )
      )
      .returning({ id: copilotReviewSessions.id })

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Review session not found' },
        { status: 404 }
      )
    }

    logger.info('Review session title updated', {
      reviewSessionId: parsed.reviewSessionId,
      title: parsed.title,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error updating review session title:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update review session title' },
      { status: 500 }
    )
  }
}
