import { db } from '@tradinggoose/db'
import { account } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthDisconnectAPI')

/**
 * Disconnect one OAuth account for the current user.
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated disconnect request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { accountId } = await request.json()

    if (typeof accountId !== 'string' || !accountId.trim()) {
      logger.warn(`[${requestId}] Missing accountId in disconnect request`)
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Processing OAuth disconnect request`, {
      accountId,
    })

    await db
      .delete(account)
      .where(and(eq(account.userId, session.user.id), eq(account.id, accountId.trim())))

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error disconnecting OAuth account`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
