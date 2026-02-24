import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { exportWatchlistItemsAsText } from '@/lib/watchlists/import-export'
import { getWatchlist, WatchlistOperationError } from '@/lib/watchlists/operations'

const logger = createLogger('WatchlistExportAPI')

const requireSessionUser = async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    throw new WatchlistOperationError('Unauthorized', 401)
  }
  return session.user.id
}

const requireWorkspacePermission = async (userId: string, workspaceId: string) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    throw new WatchlistOperationError('Access denied', 403)
  }
}

const handleRouteError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof WatchlistOperationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  logger.error(fallbackMessage, { error })
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

export async function GET(
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

    await requireWorkspacePermission(userId, workspaceId)

    const watchlist = await getWatchlist(
      {
        workspaceId,
        userId,
      },
      watchlistId
    )

    const body = exportWatchlistItemsAsText(watchlist.items)
    const fileName = `${watchlist.name.replace(/\s+/g, '_').toLowerCase() || 'watchlist'}.txt`

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to export watchlist')
  }
}
