import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { listWatchlists, WatchlistOperationError } from '@/lib/watchlists/operations'

const logger = createLogger('WatchlistsAPI')

const requireSessionUser = async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    throw new WatchlistOperationError(auth.error || 'Unauthorized', 401)
  }
  return auth.userId
}

const requireWorkspacePermission = async (userId: string, workspaceId: string) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    throw new WatchlistOperationError('Access denied', 403)
  }
}

const handleRouteError = (error: unknown, errorMessage: string) => {
  if (error instanceof WatchlistOperationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Invalid request data', details: error.errors },
      { status: 400 }
    )
  }
  logger.error(errorMessage, { error })
  return NextResponse.json({ error: errorMessage }, { status: 500 })
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireSessionUser(request)
    const workspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim()
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    await requireWorkspacePermission(userId, workspaceId)

    const watchlists = await listWatchlists({ workspaceId })

    return NextResponse.json({ watchlists }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch watchlists')
  }
}
