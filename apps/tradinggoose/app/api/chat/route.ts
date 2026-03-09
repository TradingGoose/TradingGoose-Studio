import { db } from '@tradinggoose/db'
import { chat } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatAPI')

export async function GET(_request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const deployments = await db.select().from(chat).where(eq(chat.userId, session.user.id))
    return createSuccessResponse({ deployments })
  } catch (error: any) {
    logger.error('Error fetching chat deployments:', error)
    return createErrorResponse(error.message || 'Failed to fetch chat deployments', 500)
  }
}

export async function POST(_request: NextRequest) {
  return createErrorResponse(
    'Chat publishing is managed from workflow deployment. Configure the Chat trigger and deploy the workflow instead.',
    400
  )
}
