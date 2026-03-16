import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { WatchlistOperationError, appendWatchlistItemsToWatchlist } from '@/lib/watchlists/operations'
import type { WatchlistItem } from '@/lib/watchlists/types'
import { normalizeWatchlistItems } from '@/lib/watchlists/validation'

const logger = createLogger('WatchlistImportAPI')

const WatchlistImportSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  items: z.array(z.unknown()),
})

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
  if (permission === 'read') {
    throw new WatchlistOperationError('Write permission required', 403)
  }
}

const normalizeImportedWatchlistItems = (entries: unknown[]): WatchlistItem[] => {
  const items = normalizeWatchlistItems(entries)
  if (items.length !== entries.length) {
    throw new WatchlistOperationError('Invalid watchlist items payload', 400)
  }
  return items
}

const handleRouteError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof WatchlistOperationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 })
  }
  logger.error(fallbackMessage, { error })
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ watchlistId: string }> }
) {
  try {
    const userId = await requireSessionUser()
    const { watchlistId } = await params
    const parsed = WatchlistImportSchema.parse(await request.json())
    await requireWorkspacePermission(userId, parsed.workspaceId)

    const items = normalizeImportedWatchlistItems(parsed.items)

    const result = await appendWatchlistItemsToWatchlist(
      {
        workspaceId: parsed.workspaceId,
        userId,
      },
      watchlistId,
      items
    )

    return NextResponse.json(
      {
        watchlist: result.watchlist,
        import: {
          addedCount: result.addedCount,
          skippedCount: result.skippedCount,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    return handleRouteError(error, 'Failed to import watchlist')
  }
}
