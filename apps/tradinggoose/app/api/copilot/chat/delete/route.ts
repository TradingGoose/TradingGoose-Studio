import { db } from '@tradinggoose/db'
import { copilotReviewSessions } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DeleteChatAPI')

const DeleteChatSchema = z.object({
  reviewSessionId: z.string(),
})

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = DeleteChatSchema.parse(body)

    const deleted = await db
      .delete(copilotReviewSessions)
      .where(
        and(
          eq(copilotReviewSessions.id, parsed.reviewSessionId),
          eq(copilotReviewSessions.userId, session.user.id)
        )
      )
      .returning({ id: copilotReviewSessions.id })

    if (deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Review session not found' },
        { status: 404 }
      )
    }

    logger.info('Review session deleted', { reviewSessionId: parsed.reviewSessionId })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting review session:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete review session' },
      { status: 500 }
    )
  }
}
