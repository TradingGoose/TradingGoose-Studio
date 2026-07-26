import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { WatchlistOperationError } from '@/lib/watchlists/operations'
import { deleteSavedEntity } from '@/lib/yjs/server/entity-loaders'
import { createSavedEntityErrorResponse } from '@/app/api/saved-entity-error-response'

const logger = createLogger('WatchlistByIdAPI')

const requireSessionUser = async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    throw new WatchlistOperationError('Unauthorized', 401)
  }
  return session.user.id
}

const requireWorkspacePermission = async (
  userId: string,
  workspaceId: string,
  options: { write?: boolean } = {}
) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    throw new WatchlistOperationError('Access denied', 403)
  }
  if (options.write && permission !== 'admin' && permission !== 'write') {
    throw new WatchlistOperationError('Write permission required', 403)
  }
}

const handleRouteError = (error: unknown, errorMessage: string) => {
  if (error instanceof WatchlistOperationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Invalid request data', details: error.issues },
      { status: 400 }
    )
  }
  const realtimeResponse = createSavedEntityErrorResponse(error)
  if (realtimeResponse) return realtimeResponse
  logger.error(errorMessage, { error })
  return NextResponse.json({ error: errorMessage }, { status: 500 })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ watchlistId: string }> }
) {
  try {
    const userId = await requireSessionUser()
    const { watchlistId } = await params
    const workspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim()
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    await requireWorkspacePermission(userId, workspaceId, { write: true })

    const deleted = await deleteSavedEntity('watchlist', watchlistId, workspaceId)
    if (!deleted) {
      return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to delete watchlist')
  }
}
