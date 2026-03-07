import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getEmailDomain } from '@/lib/urls/utils'
import { checkChatAccess } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ChatDetailAPI')

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const { hasAccess, chat: chatRecord } = await checkChatAccess(id, session.user.id)
    if (!hasAccess || !chatRecord) {
      return createErrorResponse('Chat not found or access denied', 404)
    }

    const { password, ...safeData } = chatRecord
    const chatUrl = `${process.env.NODE_ENV === 'development' ? 'http' : 'https'}://${getEmailDomain()}/chat/${chatRecord.identifier}`

    return createSuccessResponse({
      ...safeData,
      chatUrl,
      hasPassword: Boolean(password),
    })
  } catch (error: any) {
    logger.error('Error fetching chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to fetch chat deployment', 500)
  }
}

export async function PATCH(_request: NextRequest, _context: { params: Promise<{ id: string }> }) {
  return createErrorResponse(
    'Chat publishing is managed from workflow deployment. Update the Chat trigger draft and redeploy the workflow instead.',
    400
  )
}

export async function DELETE(_request: NextRequest, _context: { params: Promise<{ id: string }> }) {
  return createErrorResponse(
    'Chat publishing is managed from workflow deployment. Undeploy the workflow instead.',
    400
  )
}
