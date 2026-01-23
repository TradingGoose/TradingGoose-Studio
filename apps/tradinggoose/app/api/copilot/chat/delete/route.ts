import { db } from '@tradinggoose/db'
import { copilotChats } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DeleteChatAPI')

const DeleteChatSchema = z.object({
  chatId: z.string(),
})

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = DeleteChatSchema.parse(body)

    // Delete the chat only if it belongs to the current user
    const deleted = await db
      .delete(copilotChats)
      .where(and(eq(copilotChats.id, parsed.chatId), eq(copilotChats.userId, session.user.id)))
      .returning({ id: copilotChats.id })

    if (deleted.length === 0) {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    logger.info('Chat deleted', { chatId: parsed.chatId })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting chat:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete chat' }, { status: 500 })
  }
}
